import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { unzipCode } from '~/lib/persistenceGitbase/utils';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { fetchVerse, extractProjectInfoFromPlayUrl } from '~/lib/verse8/api';

export const action = withV8AuthUser(forkAction);

async function forkAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  const {
    projectPath,
    projectName,
    description,
    commitSha: requestCommitSha,
    metadata,
  } = (await request.json()) as {
    projectPath: string;
    projectName: string;
    description: string;
    commitSha?: string;
    metadata?: {
      resetEnv?: boolean;
      fromVerseId?: string;
    };
  };

  let commitSha = requestCommitSha;
  let verseData: any = null;

  const email = user.email;

  if (!projectPath) {
    return new Response('Project path is required', { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  // Check fork permissions
  try {
    // Check if user owns the project
    const isOwner = await gitlabService.isProjectOwner(email, projectPath);

    if (!isOwner) {
      // If not the owner, check verse permissions
      if (!metadata?.fromVerseId) {
        try {
          const visibility = await gitlabService.getProjectVisibility(projectPath);

          if (visibility !== 'public') {
            throw new Error('Project is not public');
          }
        } catch {
          return json(
            {
              success: false,
              message: 'You can only fork your own projects, public projects, or projects with verse remix permission',
            },
            { status: 403 },
          );
        }
      } else {
        // Fetch and validate verse data
        verseData = await fetchVerse(metadata.fromVerseId, env);

        if (!verseData) {
          return json({ success: false, message: 'Verse not found or not accessible' }, { status: 400 });
        }

        // Check if remix is allowed
        if (!verseData.allowRemix) {
          return json({ success: false, message: 'This verse does not allow remixing' }, { status: 403 });
        }

        // Extract and validate project info from verse playUrl
        const { projectPath: verseProjectPath, sha: verseSha } = extractProjectInfoFromPlayUrl(verseData.playUrl);

        // Validate that the requested projectPath matches the verse's project
        if (projectPath !== verseProjectPath) {
          return json({ success: false, message: 'Project path does not match verse project' }, { status: 400 });
        }

        /*
         * If commitSha is provided, validate it matches the verse's SHA
         * if (commitSha && commitSha !== verseSha) {
         *   return json({ success: false, message: 'Commit SHA does not match verse version' }, { status: 400 });
         * }
         */

        // Use verse SHA if no commitSha provided
        if (!commitSha) {
          commitSha = verseSha;
        }
      }
    } else if (metadata?.fromVerseId) {
      // If owner is forking their own project with verse metadata, still validate verse
      verseData = await fetchVerse(metadata.fromVerseId, env);

      if (verseData) {
        const { sha: verseSha } = extractProjectInfoFromPlayUrl(verseData.playUrl);

        // Use verse SHA if no commitSha provided
        if (!commitSha) {
          commitSha = verseSha;
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Permission check failed';
    return json({ success: false, message: errorMessage }, { status: 400 });
  }

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
        content: metadata?.resetEnv && path.endsWith('.env') ? '' : (file as any).content,
      }));

    // 6. 새 프로젝트에 파일 커밋
    await gitlabService.commitFiles(newProject.id, filesToCommit, `Fork from ${projectPath}`, 'develop');

    // 7. Create tags for tracking fork origin and verse information
    try {
      // Create fork-from tag
      const forkFromTag = `fork-from-${projectPath.replace(/[^a-zA-Z0-9-]/g, '-')}`;
      await gitlabService.createTag(
        newProject.id,
        forkFromTag,
        'develop',
        `Forked from ${projectPath} at ${commitSha}`,
      );

      // Create verse-from tag if this is a verse-based fork
      if (verseData?.verseId) {
        const verseSpinTag = `verse-from-${verseData.verseId.replace(/[^a-zA-Z0-9-]/g, '-')}`;
        await gitlabService.createTag(newProject.id, verseSpinTag, 'develop', `Spun from verse: ${verseData.verseId}`);
      }
    } catch (tagError) {
      console.warn('Failed to create tags for fork tracking:', tagError);

      // Don't fail the fork operation if tag creation fails
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
