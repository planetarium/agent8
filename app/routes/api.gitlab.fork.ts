import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { unzipCode } from '~/lib/persistenceGitbase/utils';
import { withV8AuthUser } from '~/lib/verse8/middleware';

export const action = withV8AuthUser(forkAction, { checkCredit: true });

async function forkAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  const { projectPath, projectName, description, commitSha, sourceInfo } = (await request.json()) as {
    projectPath: string;
    projectName: string;
    description: string;
    commitSha?: string;
    sourceInfo?: {
      sourceProjectPath: string;
      sourceSha: string;
    };
  };

  const email = user.email;

  if (!projectPath) {
    return new Response('Project path is required', { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    let actualCommitSha = commitSha;

    // If no commitSha provided, get the latest commit from develop branch
    if (!actualCommitSha) {
      const project = await gitlabService.gitlab.Projects.show(projectPath);
      const defaultBranch = (project as any).default_branch || 'develop';
      const commits = await gitlabService.gitlab.Commits.all(projectPath, {
        refName: defaultBranch,
        perPage: 1,
      });

      if (commits.length > 0) {
        actualCommitSha = commits[0].id;
      } else {
        return json({ success: false, message: 'No commits found in the repository' }, { status: 400 });
      }
    }

    // Extract verse information if this is a spin fork
    let verseInfo: string | null = null;

    if (sourceInfo) {
      try {
        const envContent = await gitlabService.getFileContent(
          sourceInfo.sourceProjectPath,
          '.env',
          sourceInfo.sourceSha,
        );

        if (envContent) {
          const verseMatch = envContent.match(/VITE_AGENT8_VERSE\s*=\s*(.+)/);

          if (verseMatch && verseMatch[1]) {
            verseInfo = verseMatch[1].trim();
          }
        }
      } catch (error) {
        console.warn('Failed to extract verse information:', error);
      }
    }

    // 1. 원본 레포지토리에서 특정 커밋 기준으로 코드 다운로드
    const codeBuffer = await gitlabService.downloadCode(projectPath, actualCommitSha);

    // 2. 임시 디렉토리에 압축 해제 (서버 측 구현 필요)
    const extractedFiles = await unzipCode(codeBuffer); // 별도 구현 필요

    // 3. 새 사용자 확인/생성
    const gitlabUser = await gitlabService.getOrCreateUser(email);

    // 4. 새 프로젝트 생성
    const newProject = await gitlabService.createProject(gitlabUser, projectName, description);

    // 5. 파일 목록 생성
    const filesToCommit = Object.entries(extractedFiles)
      .filter(([_, file]) => file && (file as any).content)
      .map(([path, file]) => ({
        path,
        content: (file as any).content,
      }));

    // 6. 새 프로젝트에 파일 커밋
    await gitlabService.commitFiles(newProject.id, filesToCommit, `Fork from ${projectPath}`, 'develop');

    // 7. Create tags for tracking fork origin and verse information
    if (sourceInfo) {
      try {
        // Create fork-from tag
        const forkFromTag = `fork-from-${sourceInfo.sourceProjectPath.replace(/[^a-zA-Z0-9-]/g, '-')}`;
        await gitlabService.createTag(
          newProject.id,
          forkFromTag,
          'develop',
          `Forked from ${sourceInfo.sourceProjectPath} at ${sourceInfo.sourceSha}`,
        );

        // Create verse-from tag if verse information is available
        if (verseInfo) {
          const verseFromTag = `verse-from-${verseInfo.replace(/[^a-zA-Z0-9-]/g, '-')}`;
          await gitlabService.createTag(newProject.id, verseFromTag, 'develop', `Original verse: ${verseInfo}`);
        }
      } catch (tagError) {
        console.warn('Failed to create tags for fork tracking:', tagError);

        // Don't fail the fork operation if tag creation fails
      }
    }

    return json({
      success: true,
      project: {
        path: newProject.path_with_namespace,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to fork repository: ${errorMessage}`);
  }
}
