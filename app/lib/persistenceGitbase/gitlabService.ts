import { Gitlab } from '@gitbeaker/rest';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import os from 'os';

import type {
  GitlabUser,
  GitlabProject,
  GitlabCommit,
  GitlabProtectedBranch,
  CommitAction,
  FileContent,
} from './types';
import axios from 'axios';

export class GitlabService {
  gitlab: InstanceType<typeof Gitlab>;
  gitlabUrl: string;
  gitlabToken: string;

  constructor(env: Env) {
    this.gitlabUrl = env.GITLAB_URL || 'https://gitlab.verse8.io';
    this.gitlabToken = env.GITLAB_TOKEN || '';

    if (!this.gitlabToken) {
      console.warn('GITLAB_TOKEN is not set. GitLab API calls may fail.');
    }

    // Initialize GitLab client
    this.gitlab = new Gitlab({
      host: this.gitlabUrl,
      token: this.gitlabToken,
    });
  }

  /**
   * 사용자를 생성하거나 찾아옵니다
   * @param email 사용자 이메일
   */
  async getOrCreateUser(email: string): Promise<GitlabUser> {
    try {
      // 사용자 검색
      const users = await this.gitlab.Users.all({
        search: email,
      });

      // 이메일이 정확히 일치하는 사용자 찾기
      const existingUser = users.find((user: any) => user.email?.toLowerCase() === email.toLowerCase());

      if (existingUser) {
        return existingUser as unknown as GitlabUser;
      }

      // 기본 username 생성
      const baseUsername = email.split('@')[0];

      // 동일한 사용자명이 존재하는지 확인
      const usernameCheck = await this.gitlab.Users.all({
        search: baseUsername,
      });

      // 사용자명 충돌 방지 로직
      let username = baseUsername;
      let usernameAvailable = false;

      // 기존 이름과 정확히 일치하는 사용자가 있는지 확인
      const exactNameMatch = usernameCheck.some((user: any) => {
        const userName = (user.username || '').toLowerCase();
        return userName === baseUsername.toLowerCase();
      });

      if (exactNameMatch) {
        console.log(`사용자명 "${baseUsername}"은 이미 사용 중입니다. 대체 이름을 생성합니다.`);

        // 숫자 1-9를 붙여서 시도
        for (let i = 1; i <= 9; i++) {
          const tempUsername = `${baseUsername}${i}`;

          // 해당 이름으로 사용자가 있는지 확인
          const nameExists = usernameCheck.some((user: any) => {
            const userName = (user.username || '').toLowerCase();
            return userName === tempUsername.toLowerCase();
          });

          if (!nameExists) {
            username = tempUsername;
            usernameAvailable = true;
            console.log(`사용 가능한 이름을 찾았습니다: ${username}`);
            break;
          }
        }

        // 숫자 1-9로도 안되면 타임스탬프 추가
        if (!usernameAvailable) {
          const timestamp = Date.now();
          username = `${baseUsername}_${timestamp}`;
          console.log(`모든 숫자 조합이 사용 중입니다. 타임스탬프를 추가합니다: ${username}`);
        }
      }

      // 사용자명 적용하여 사용자 생성
      console.log(`새 사용자 생성 시도: ${username} (${email})`);

      const newUser = await this.gitlab.Users.create({
        email,
        username,
        password: this._generateRandomPassword(),
        name: username, // name도 username과 동일하게 설정
        skipConfirmation: true,
      });

      // 안전한 속성 접근
      const newUsername = newUser.username || 'unknown';
      const newUserId = newUser.id || 'unknown';
      console.log(`새 사용자가 생성되었습니다: ${newUsername} (ID: ${newUserId})`);

      return newUser as unknown as GitlabUser;
    } catch (error) {
      console.error('사용자 생성 오류 상세:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create or find user: ${errorMessage}`);
    }
  }

  async getProject(user: GitlabUser, projectName: string): Promise<GitlabProject> {
    try {
      /*
       * 프로젝트 이름이 일치하는 프로젝트 찾기
       * GitLab API에서 직접 호출하는 방식으로 처리
       */
      const response = await fetch(
        `${this.gitlabUrl}/api/v4/users/${user.id}/projects?owned=true&search=${encodeURIComponent(
          projectName,
        )}&per_page=100`,
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`API 요청 실패: ${response.status} ${response.statusText}`);
      }

      const projects = (await response.json()) as GitlabProject[];

      // 이름이 정확히 일치하는 프로젝트 찾기
      const project = projects.find((p: any) => p.name.toLowerCase() === projectName.toLowerCase());

      if (!project) {
        throw new Error(`Not Found Project '${projectName}'`);
      }

      return {
        id: project.id,
        name: project.name,
        path_with_namespace: project.path_with_namespace,
        default_branch: project.default_branch,
        created_at: project.created_at,
        updated_at: project.updated_at,
        description: project.description,
        visibility: project.visibility,
      } as GitlabProject;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get or create project: ${errorMessage}`);
    }
  }

  /**
   * 프로젝트를 생성합니다.
   * 동일한 이름의 프로젝트가 이미 존재하는 경우 타임스탬프를 붙여 생성합니다.
   * @param userId 사용자 ID
   * @param projectName 프로젝트 이름
   * @param description 프로젝트 설명 (선택사항)
   */
  async createProject(user: GitlabUser, projectName: string, description?: string): Promise<GitlabProject> {
    try {
      // 동일 이름의 프로젝트가 존재하는지 확인
      const response = await fetch(
        `${this.gitlabUrl}/api/v4/users/${user.id}/projects?owned=true&search=${encodeURIComponent(
          projectName,
        )}&per_page=100`,
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`API 요청 실패: ${response.status} ${response.statusText}`);
      }

      const existingProjects = (await response.json()) as GitlabProject[];

      // 이미 존재하면 타임스탬프 추가
      let finalProjectName = projectName;

      // 이름이 정확히 일치하는 프로젝트 찾기
      const exactMatch = existingProjects.find((p: any) => p.name?.toLowerCase() === projectName.toLowerCase());

      if (exactMatch) {
        const timestamp = new Date().getTime();
        finalProjectName = `${projectName}-${timestamp}`;
        console.log(`동일한 이름의 프로젝트가 존재합니다. 새 이름으로 시도: ${finalProjectName}`);
      }

      // 프로젝트 생성
      const project = await this.gitlab.Projects.create({
        name: finalProjectName,
        namespaceId: user.namespace_id,
        visibility: 'private',
        initializeWithReadme: true,
        description: description || `${finalProjectName}`,
      });

      console.log(`프로젝트 생성 성공: ${finalProjectName} (ID: ${project.id})`);

      // initializeWithReadme를 true로 설정해도 초기화가 안될 경우를 대비한 fallback
      try {
        // 프로젝트의 기본 브랜치를 확인 (대부분 'main')
        const projectDetail = await this.gitlab.Projects.show(project.id);

        if (!projectDetail.default_branch) {
          // 기본 브랜치가 없으면 README.md 파일을 포함한 초기 커밋 생성
          console.log('프로젝트에 기본 브랜치가 없어 초기 커밋을 생성합니다.');

          const initialCommitActions = [
            {
              action: 'create' as const,
              filePath: 'README.md',
              content: `# ${finalProjectName}\n\n${description || ''}`,
            },
          ];

          // 초기 커밋 생성 (main 브랜치로)
          await this.gitlab.Commits.create(project.id, 'main', 'Initial Commit', initialCommitActions);

          console.log('초기 커밋 생성 완료');
        }
      } catch (branchError) {
        console.error('브랜치 생성 중 오류 발생:', branchError);

        // 오류에도 불구하고 초기 커밋 시도
        try {
          console.log('오류 발생 후 초기 커밋 재시도');

          const initialCommitActions = [
            {
              action: 'create' as const,
              filePath: 'README.md',
              content: `# ${finalProjectName}\n\n${description || ''}`,
            },
          ];

          await this.gitlab.Commits.create(project.id, 'main', 'Initial Commit', initialCommitActions);
          console.log('재시도 초기 커밋 성공');
        } catch (retryError) {
          console.error('초기 커밋 재시도 실패:', retryError);
        }
      }

      return project as unknown as GitlabProject;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create project: ${errorMessage}`);
    }
  }

  /**
   * ZIP 파일을 사용하여 코드를 리포지토리에 커밋합니다.
   * ZIP 파일의 모든 내용을 추출하여 리포지토리에 커밋합니다.
   * 이 방식은 프로젝트 전체를 업데이트하며, ZIP에 없는 기존 파일은 삭제됩니다.
   *
   * @param projectId 프로젝트 ID
   * @param zipBuffer ZIP 파일 버퍼
   * @param commitMessage 커밋 메시지
   */
  async commitCodeWithZip(projectId: number, zipBuffer: Buffer, commitMessage: string): Promise<GitlabCommit> {
    try {
      const tempDir = path.join(os.tmpdir(), `gitlab-commit-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const zip = new JSZip();
      const zipContent = await zip.loadAsync(zipBuffer);

      // 파일 추출 및 저장
      const files: string[] = [];
      const extractPromises: Promise<void>[] = [];

      zipContent.forEach((relativePath, file) => {
        if (!file.dir) {
          const fullPath = path.join(tempDir, relativePath);
          const dirPath = path.dirname(fullPath);

          // 디렉토리 생성
          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
          }

          // 파일 저장
          const extractPromise = file.async('nodebuffer').then((content) => {
            fs.writeFileSync(fullPath, content);
            files.push(fullPath);
          });

          extractPromises.push(extractPromise);
        }
      });

      // 모든 파일 추출 완료 대기
      await Promise.all(extractPromises);

      // 각 파일을 GitLab API를 통해 커밋
      const actions: CommitAction[] = files.map((file) => {
        const relativePath = path.relative(tempDir, file);
        const content = fs.readFileSync(file, 'utf-8');

        return {
          action: 'create',
          filePath: relativePath,
          content,
        };
      });

      // 프로젝트의 기존 파일 목록 가져오기
      console.log('기존 파일 목록 가져오기...');

      const existingFiles = await this._getProjectFiles(projectId);
      console.log(`기존 파일 수: ${existingFiles.length}`);

      // 새 ZIP에 없는 기존 파일은 삭제 액션을 추가
      const zipFilePaths = files.map((file) => path.relative(tempDir, file));

      for (const existingFile of existingFiles) {
        if (!zipFilePaths.includes(existingFile)) {
          actions.push({
            action: 'delete',
            filePath: existingFile,
          });
        }
      }

      // 커밋 - main 브랜치에 커밋
      const result = await this.gitlab.Commits.create(
        projectId,
        'main', // 기본 main 브랜치 사용
        commitMessage,
        actions,
      );

      // 임시 디렉토리 정리
      fs.rmSync(tempDir, { recursive: true, force: true });

      return result as unknown as GitlabCommit;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to commit code: ${errorMessage}`);
    }
  }

  /**
   * 개별 파일 내용을 사용하여 리포지토리에 커밋합니다.
   * 이 방식은 지정된 파일만 수정하며, 나머지 파일은 그대로 유지됩니다.
   *
   * @param projectId 프로젝트 ID
   * @param files 파일 목록 (경로와 내용)
   * @param commitMessage 커밋 메시지
   * @param branch 브랜치 이름
   */
  async commitFiles(
    projectId: number,
    files: FileContent[],
    commitMessage: string,
    branch: string = 'main',
  ): Promise<GitlabCommit> {
    try {
      console.log(`GitLab URL: ${this.gitlabUrl}`);
      console.log(`ProjectID: ${projectId}, Branch: ${branch}`);
      console.log(`커밋할 파일 수: ${files.length}`);

      // 프로젝트 정보 확인
      let defaultBranchName = '';

      try {
        const project = await this.gitlab.Projects.show(projectId);
        console.log(`프로젝트 확인: ${project.name} (${project.id})`);
        defaultBranchName = (project.default_branch as string) || '';

        // 브랜치 보호 설정 확인
        const protectedBranches = (await this.gitlab.ProtectedBranches.all(projectId)) as GitlabProtectedBranch[];
        const isProtected = protectedBranches.some((pb) => pb.name === branch);

        if (isProtected) {
          console.log(`경고: ${branch} 브랜치는 보호되어 있어 직접 푸시가 제한될 수 있습니다.`);

          // 대체 브랜치를 생성하여 MR(Merge Request)를 통해 커밋
          const tempBranch = `temp-${Date.now()}`;
          console.log(`대체 브랜치 생성: ${tempBranch}`);

          // 기본 브랜치에서 임시 브랜치 생성
          await this.gitlab.Branches.create(projectId, tempBranch, branch);
          branch = tempBranch;
        }
      } catch (projectError) {
        console.error('프로젝트를 찾을 수 없습니다:', projectError);
        throw new Error(`Project not found: ${projectId}`);
      }

      // 브랜치 존재 여부 확인
      let branchExists = false;

      try {
        await this.gitlab.Branches.show(projectId, branch);
        console.log(`브랜치 확인: ${branch} 존재함`);
        branchExists = true;
      } catch {
        console.log(`브랜치를 찾을 수 없습니다: ${branch}`);
        branchExists = false;
      }

      // 브랜치가 존재하지 않는 경우 처리
      if (!branchExists) {
        // 기본 브랜치가 있으면 그 브랜치에서 새 브랜치 생성
        if (defaultBranchName) {
          try {
            console.log(`${branch} 브랜치를 ${defaultBranchName}에서 생성`);
            await this.gitlab.Branches.create(projectId, branch, defaultBranchName);
            branchExists = true;
          } catch (createBranchError) {
            console.error(`${branch} 브랜치 생성 실패:`, createBranchError);
          }
        }

        // 여전히 브랜치가 없으면 초기 커밋 생성
        if (!branchExists) {
          console.log('초기 커밋을 생성합니다 (브랜치가 없거나 생성 실패)');

          try {
            const initialActions: CommitAction[] = [
              {
                action: 'create' as const,
                filePath: 'README.md',
                content: `# Project ${projectId}\n\nThis is a new project.`,
              },
            ];

            await this.gitlab.Commits.create(projectId, branch, 'Initial Commit', initialActions);
            console.log(`${branch} 브랜치에 초기 커밋 생성 완료`);
            branchExists = true;
          } catch (initialCommitError) {
            console.error('초기 커밋 실패:', initialCommitError);
            throw new Error(`Cannot create initial commit to branch: ${branch}`);
          }
        }
      }

      // 기존 파일 목록 가져오기
      console.log('기존 파일 목록 가져오기...');

      const existingFiles = await this._getProjectFiles(projectId, branch);
      console.log(`기존 파일 수: ${existingFiles.length}`);

      // 파일 목록을 커밋 액션으로 변환
      const actions: CommitAction[] = [];

      for (const file of files) {
        // 파일이 이미 존재하는지 확인
        const fileExists = existingFiles.includes(file.path);
        const action: CommitAction = {
          action: fileExists ? ('update' as const) : ('create' as const),
          filePath: file.path,
          content: file.content,
        };
        actions.push(action);
        console.log(`파일 ${file.path}: ${fileExists ? '업데이트' : '생성'}`);
      }

      console.log('GitLab API 커밋 요청 보내기...');

      // 커밋 시도
      let result;

      try {
        result = await this.gitlab.Commits.create(projectId, branch, commitMessage, actions);

        // TypeScript에 안전한 방식으로 ID에 접근
        console.log('커밋 완료:', result?.id || 'ID 없음');
      } catch (commitError: any) {
        // 만약 권한 오류라면 다른 방법 시도
        const responseStatus =
          typeof commitError === 'object' &&
          commitError !== null &&
          typeof commitError.cause === 'object' &&
          commitError.cause !== null &&
          typeof commitError.cause.response === 'object' &&
          commitError.cause.response !== null
            ? commitError.cause.response.status
            : null;

        if (responseStatus === 403) {
          console.log('권한 오류 발생, 대체 방법 시도 중...');

          // 1. 각 파일을 개별적으로 업로드 시도
          try {
            console.log('파일을 개별적으로 커밋 시도...');

            // 파일들을 개별적으로 저장
            for (const file of files) {
              try {
                if (existingFiles.includes(file.path)) {
                  // 파일이 존재하면 업데이트
                  await this.gitlab.RepositoryFiles.edit(
                    projectId,
                    file.path,
                    branch,
                    file.content,
                    `${commitMessage}: ${file.path}`,
                  );
                } else {
                  // 파일이 없으면 새로 생성
                  await this.gitlab.RepositoryFiles.create(
                    projectId,
                    file.path,
                    branch,
                    file.content,
                    `${commitMessage}: ${file.path}`,
                  );
                }

                console.log(`파일 개별 저장 성공: ${file.path}`);
              } catch (fileError) {
                console.error(`파일 저장 실패: ${file.path}`, fileError);
              }
            }

            // 마지막 커밋 가져오기
            const lastCommit = await this._getLastCommit(projectId, branch);
            result = lastCommit;
          } catch (individualError) {
            console.error('개별 파일 업로드 실패:', individualError);

            const safeCommitError = typeof commitError === 'object' && commitError !== null ? commitError : {};
            const statusText =
              typeof safeCommitError.response === 'object' && safeCommitError.response !== null
                ? safeCommitError.response.statusText
                : null;
            const message = typeof safeCommitError.message === 'string' ? safeCommitError.message : null;

            const errorMessage = statusText || message || 'Forbidden';
            throw new Error(`권한이 없습니다: ${errorMessage}`);
          }
        } else {
          throw commitError;
        }
      }

      return result as unknown as GitlabCommit;
    } catch (error) {
      console.error('커밋 실패 상세 정보:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to commit files: ${errorMessage}`);
    }
  }

  /**
   * 프로젝트의 마지막 커밋 정보를 가져옵니다
   * @param projectId 프로젝트 ID
   * @param branch 브랜치 이름
   */
  private async _getLastCommit(projectId: number, branch: string = 'main'): Promise<GitlabCommit> {
    try {
      const commits = await this.gitlab.Commits.all(projectId, {
        refName: branch,
        perPage: 1,
      });

      if (commits && commits.length > 0) {
        return commits[0] as unknown as GitlabCommit;
      }

      throw new Error('No commits found');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get last commit: ${errorMessage}`);
    }
  }

  /**
   * 프로젝트의 모든 파일 경로 목록을 가져옵니다
   * @param projectId 프로젝트 ID
   * @param branch 브랜치 이름
   */
  private async _getProjectFiles(projectId: number, branch: string = 'main'): Promise<string[]> {
    try {
      // GitLab API를 직접 호출하여 파일 트리 가져오기
      const response = await fetch(
        `${this.gitlabUrl}/api/v4/projects/${projectId}/repository/tree?recursive=true&ref=${encodeURIComponent(
          branch,
        )}&per_page=100`,
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`API 요청 실패: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // 타입 안전성 확보
      interface TreeItem {
        path: string;
        type: string;
      }

      // 디렉토리가 아닌 파일만 필터링
      const files = (data as TreeItem[]).filter((item) => item.type === 'blob').map((item) => item.path);

      return files;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get project files: ${errorMessage}`);
    }
  }

  /**
   * 리포지토리에서 코드를 ZIP으로 다운로드합니다
   * @param projectPath 프로젝트 경로
   * @param commitSha 커밋 해시 (옵션)
   */
  async downloadCode(projectPath: string, commitSha?: string): Promise<Buffer> {
    try {
      const ref = commitSha || 'main'; // 커밋이 없으면 main 브랜치 사용

      // 프로젝트 ID 가져오기
      const project = await this.gitlab.Projects.show(projectPath);

      const response = await axios({
        method: 'GET',
        url: `${this.gitlabUrl}/api/v4/projects/${project.id}/repository/archive.zip`,
        params: { sha: ref },
        responseType: 'arraybuffer',
        headers: {
          'PRIVATE-TOKEN': this.gitlabToken,
        },
      });

      if (response.status !== 200) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      return Buffer.from(response.data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to download code: ${errorMessage}`);
    }
  }

  /**
   * 랜덤 비밀번호 생성
   */
  private _generateRandomPassword(): string {
    const length = 16;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
    let password = '';

    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return password;
  }

  /**
   * 사용자 이름과 프로젝트 이름으로 프로젝트를 찾습니다
   * @param username 사용자 이름
   * @param projectName 프로젝트 이름
   */
  async findProject(username: string, projectName: string): Promise<GitlabProject> {
    try {
      // GitLab 프로젝트 경로 생성
      const projectPath = `${username}/${projectName}`;
      console.log(`프로젝트 조회: ${projectPath}`);

      // GitLab API를 통해 프로젝트 조회
      const project = await this.gitlab.Projects.show(projectPath);

      return project as unknown as GitlabProject;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to find project: ${errorMessage}`);
    }
  }

  /**
   * 이메일 주소로 사용자의 프로젝트 목록을 최근 업데이트 순으로 가져옵니다
   * @param email 사용자 이메일
   * @param page 페이지 번호 (1부터 시작)
   * @param perPage 페이지당 항목 수
   */
  async getUserProjects(
    email: string,
    page: number = 1,
    perPage: number = 10,
  ): Promise<{
    projects: GitlabProject[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      // 사용자 찾기
      const user = await this.getOrCreateUser(email);
      console.log(`사용자 조회: ${user.username} (ID: ${user.id})`);

      // 직접 API 호출로 처리
      const projectsResponse = await fetch(
        `${this.gitlabUrl}/api/v4/users/${user.id}/projects?membership=true&order_by=updated_at&sort=desc&page=${page}&per_page=${perPage}&statistics=true`,
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
        },
      );

      if (!projectsResponse.ok) {
        throw new Error(`API 요청 실패: ${projectsResponse.status} ${projectsResponse.statusText}`);
      }

      const projects = (await projectsResponse.json()) as GitlabProject[];

      // X-Total 헤더에서 전체 프로젝트 수 가져오기
      const totalProjects = parseInt(projectsResponse.headers.get('x-total') || '0', 10);
      const hasMore = page * perPage < totalProjects;

      // 각 프로젝트에 마지막 커밋 정보 추가
      const enhancedProjects = await Promise.all(
        projects.map(async (project: GitlabProject) => {
          try {
            // 마지막 커밋 가져오기 - 직접 API 호출
            const commitsResponse = await fetch(
              `${this.gitlabUrl}/api/v4/projects/${project.id}/repository/commits?ref_name=${project.default_branch || 'main'}&per_page=1`,
              {
                headers: {
                  'PRIVATE-TOKEN': this.gitlabToken,
                },
              },
            );

            if (!commitsResponse.ok) {
              throw new Error(`API 요청 실패: ${commitsResponse.status} ${commitsResponse.statusText}`);
            }

            const lastCommits = (await commitsResponse.json()) as GitlabCommit[];
            const lastCommit = lastCommits.length > 0 ? lastCommits[0] : null;

            return {
              id: project.id,
              name: project.name,
              path_with_namespace: project.path_with_namespace,
              default_branch: project.default_branch,
              description: project.description,
              visibility: project.visibility,
              created_at: project.created_at,
              updated_at: project.updated_at,
              last_commit: lastCommit
                ? {
                    id: lastCommit.id,
                    message: lastCommit.message,
                    created_at: lastCommit.created_at,
                    author_name: lastCommit.author_name,
                  }
                : null,
            } as GitlabProject;
          } catch (error) {
            // 커밋을 가져오는 중 오류가 발생해도 프로젝트 정보는 반환
            console.error(`프로젝트 ${project.id}의 커밋 정보 로드 중 오류:`, error);
            return {
              id: project.id,
              name: project.name,
              path_with_namespace: project.path_with_namespace,
              default_branch: project.default_branch,
              description: project.description,
              visibility: project.visibility,
              created_at: project.created_at,
              updated_at: project.updated_at,
              last_commit: null,
            } as GitlabProject;
          }
        }),
      );

      return {
        projects: enhancedProjects,
        total: totalProjects,
        hasMore,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch user projects: ${errorMessage}`);
    }
  }

  /**
   * 특정 프로젝트의 커밋 내역을 최신순(내림차순)으로 가져옵니다
   * @param projectPath 프로젝트 경로 (path_with_namespace, 예: username/project-name)
   * @param page 페이지 번호 (1부터 시작)
   * @param perPage 페이지당 항목 수
   * @param branch 브랜치 이름 (선택사항, 기본값: 'main')
   */
  async getProjectCommits(
    projectPath: string,
    page: number = 1,
    perPage: number = 20,
    branch?: string,
  ): Promise<{
    project: {
      id: number;
      name: string;
      description: string;
    };
    commits: GitlabCommit[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      // 프로젝트 정보 조회
      console.log(`프로젝트 경로: ${projectPath}`);

      const project = await this.gitlab.Projects.show(projectPath);

      // 안전한 속성 접근
      const projectId = project.id;
      const projectName = project.name || 'unknown';
      console.log(`프로젝트 ID: ${projectId}, 이름: ${projectName}`);

      // 브랜치 정보 확인
      const defaultBranch = typeof project.default_branch === 'string' ? project.default_branch : 'main';
      const refName = branch || defaultBranch;
      console.log(`조회할 브랜치: ${refName}`);

      // 커밋 목록 가져오기 (직접 API 호출)
      const commitsResponse = await fetch(
        `${this.gitlabUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/repository/commits?ref_name=${refName}&page=${page}&per_page=${perPage}&order_by=created_at&sort=desc`,
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
        },
      );

      if (!commitsResponse.ok) {
        throw new Error(`API 요청 실패: ${commitsResponse.status} ${commitsResponse.statusText}`);
      }

      // X-Total 헤더에서 전체 커밋 수 가져오기
      const totalCommits = parseInt(commitsResponse.headers.get('x-total') || '0', 10);
      const hasMore = page * perPage < totalCommits;

      // 커밋 정보 가공
      const commitsData = (await commitsResponse.json()) as GitlabCommit[];
      const commits = commitsData.map((commit) => ({
        id: commit.id,
        short_id: commit.short_id,
        title: commit.title,
        message: commit.message,
        author_name: commit.author_name,
        author_email: commit.author_email,
        created_at: commit.created_at,
        committed_date: commit.committed_date,
        stats: commit.stats,
      })) as GitlabCommit[];

      return {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
        },
        commits,
        total: totalCommits,
        hasMore,
      };
    } catch (error) {
      console.error('커밋 목록 가져오기 오류:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch project commits: ${errorMessage}`);
    }
  }

  /**
   * 프로젝트(저장소)를 삭제합니다.
   * @param projectId 프로젝트 ID 또는 경로
   */
  async deleteProject(projectId: number | string): Promise<boolean> {
    try {
      console.log(`프로젝트 삭제 시도: ${projectId}`);

      // GitLab API를 통해 프로젝트 삭제
      await this.gitlab.Projects.remove(projectId);

      console.log(`프로젝트 삭제 성공: ${projectId}`);

      return true;
    } catch (error) {
      console.error('프로젝트 삭제 오류:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to delete project: ${errorMessage}`);
    }
  }

  async isProjectOwner(email: string, projectId: number | string): Promise<boolean> {
    try {
      console.log(`사용자 ${email}의 프로젝트 ${projectId} 삭제 권한 확인 중...`);

      // 사용자 정보 조회
      const user = await this.getOrCreateUser(email);
      console.log(`사용자 정보: ID=${user.id}, 이름=${user.username}`);

      // 프로젝트 세부 정보 가져오기
      let project;

      try {
        project = await this.gitlab.Projects.show(projectId);
        console.log(`프로젝트 정보: ID=${project.id}, 이름=${project.name}, 경로=${project.path_with_namespace}`);
      } catch (projectError) {
        console.error(`프로젝트 정보 조회 실패: ${projectId}`, projectError);
        return false; // 프로젝트가 존재하지 않으면 권한도 없음
      }

      // GitLab 관리자인 경우
      try {
        // GitLab API를 직접 호출하여 현재 사용자 정보를 가져옴
        const currentUserResponse = await fetch(`${this.gitlabUrl}/api/v4/user`, {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
        });

        if (!currentUserResponse.ok) {
          throw new Error(`API 요청 실패: ${currentUserResponse.status} ${currentUserResponse.statusText}`);
        }

        const currentUser = (await currentUserResponse.json()) as GitlabUser;

        if (currentUser && currentUser.is_admin) {
          console.log(`GitLab 토큰의 사용자는 관리자임`);
          return true;
        }
      } catch (adminCheckError) {
        console.error('GitLab 관리자 확인 실패:', adminCheckError);

        // 관리자 확인에 실패해도 계속 진행 (다른 권한 확인)
      }

      // namespace ID 비교 - 프로젝트의 namespace ID와 사용자의 namespace ID를 비교
      if (project.namespace && user.namespace_id) {
        const projectNamespaceId = project.namespace.id;
        const userNamespaceId = user.namespace_id;

        console.log(`프로젝트 namespace ID: ${projectNamespaceId}, 사용자 namespace ID: ${userNamespaceId}`);

        if (projectNamespaceId === userNamespaceId) {
          console.log(`사용자 ${email}은 프로젝트 ${project.name}에 대한 삭제 권한이 있음 (namespace 일치)`);
          return true;
        }
      }

      console.log(`사용자 ${email}은 프로젝트 ${project.name}에 대한 삭제 권한이 없음 (namespace 불일치)`);

      return false;
    } catch (error) {
      console.error('권한 확인 중 오류 발생:', error);
      return false;
    }
  }

  /**
   * 프로젝트 설명을 업데이트합니다.
   * @param projectPath 프로젝트 경로 (path_with_namespace, 예: username/project-name)
   * @param description 새로운 프로젝트 설명
   * @returns 업데이트된 프로젝트 정보
   */
  async updateProjectDescription(email: string, projectPath: string, description: string): Promise<GitlabProject> {
    try {
      console.log(`프로젝트 ${projectPath}의 설명 업데이트 시도...`);

      const project = await this.gitlab.Projects.show(projectPath);

      // 권한 확인
      const hasPermission = await this.isProjectOwner(email, project.id);

      if (!hasPermission) {
        throw new Error('You do not have permission to update this project');
      }

      // GitLab API를 통해 프로젝트 업데이트
      const updatedProject = await this.gitlab.Projects.edit(project.id, {
        description,
      });

      console.log(`프로젝트 ${projectPath} 설명 업데이트 성공`);

      return {
        id: project.id,
        name: project.name,
        path_with_namespace: project.path_with_namespace,
        description: updatedProject.description,
        default_branch: project.default_branch,
        created_at: project.created_at,
        updated_at: project.updated_at,
        visibility: project.visibility,
      } as GitlabProject;
    } catch (error) {
      console.error('프로젝트 설명 업데이트 오류:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to update project description: ${errorMessage}`);
    }
  }
}
