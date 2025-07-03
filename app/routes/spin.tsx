import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from '@remix-run/react';
import { toast } from 'react-toastify';
import { motion } from 'framer-motion';
import { Button } from '~/components/ui/Button';
import { createScopedLogger } from '~/utils/logger';
import { forkProject, getPublicProject } from '~/lib/persistenceGitbase/api.client';

const logger = createScopedLogger('Spin');

interface ProjectInfo {
  id: number;
  name: string;
  path_with_namespace: string;
  description?: string;
  visibility: string;
  default_branch: string;
  latest_commit?: {
    id: string;
    message: string;
    created_at: string;
    author_name: string;
  } | null;
}

export default function Spin() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);

  const projectPath = searchParams.get('from');

  useEffect(() => {
    if (!projectPath) {
      setError('Project path is required');
      setIsLoading(false);

      return;
    }

    loadProjectInfo();
  }, [projectPath]);

  const loadProjectInfo = async () => {
    if (!projectPath) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Use single API call to get public project info
      const projectResponse = await getPublicProject(projectPath);

      if (!projectResponse.success) {
        throw new Error(projectResponse.message || 'Project not found or not accessible');
      }

      const projectData = projectResponse.data;
      setProject(projectData);
      setIsLoading(false);

      // Start creating spin immediately after a short delay for better UX
      setTimeout(() => createSpin(projectData), 500);
    } catch (error) {
      logger.error('Error loading project info:', error);

      const errorMessage = error instanceof Error ? error.message : 'Failed to load project information';
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  const createSpin = async (projectData: ProjectInfo) => {
    if (!projectData || !projectPath) {
      return;
    }

    try {
      setIsSpinning(true);
      setError(null);

      // Generate new repository name with better uniqueness
      const nameWords = projectData.name.split('-');
      let newRepoName = '';

      if (nameWords && Number.isInteger(Number(nameWords[nameWords.length - 1]))) {
        newRepoName = nameWords.slice(0, -1).join('-');
      } else {
        newRepoName = nameWords.join('-');
      }

      // Add timestamp and random suffix for better uniqueness
      const timestamp = Date.now().toString(36).slice(-6);
      const randomSuffix = Math.random().toString(36).slice(-3);
      newRepoName = `${newRepoName}-spin-${timestamp}${randomSuffix}`;

      // Fork the project from develop branch
      const forkedProject = await forkProject(
        projectPath,
        newRepoName,
        'develop',
        `Spin from ${projectData.name}${projectData.description ? `: ${projectData.description}` : ''}`,
      );

      if (forkedProject && forkedProject.success) {
        toast.success('Spin created successfully!');

        // Navigate to the new project
        navigate(`/chat/${forkedProject.project.path}`);
      } else {
        throw new Error('Failed to create spin');
      }
    } catch (error) {
      logger.error('Error creating spin:', error);

      const errorMessage = error instanceof Error ? error.message : 'Failed to create spin';
      setError(errorMessage);
      setIsSpinning(false);
    }
  };

  const handleRetry = () => {
    if (project) {
      createSpin(project);
    } else {
      loadProjectInfo();
    }
  };

  const handleCancel = () => {
    navigate(-1);
  };

  if (isLoading || isSpinning) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bolt-elements-background-depth-1 p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-bolt-elements-background-depth-2 flex items-center justify-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="w-8 h-8 border-2 border-bolt-elements-button-primary-background border-t-transparent rounded-full"
            />
          </div>
          <h1 className="text-2xl font-bold text-bolt-elements-textPrimary mb-2">
            {isSpinning ? 'Creating a spin' : 'Loading Project'}
          </h1>
          <p className="text-bolt-elements-textSecondary">
            {isSpinning ? `Creating your spin of "${project?.name}"...` : 'Gathering project details...'}
          </p>
        </motion.div>
      </div>
    );
  }

  if (error && !isSpinning) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bolt-elements-background-depth-1 p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
            <div className="i-ph:warning-circle-bold text-red-500 text-3xl" />
          </div>
          <h1 className="text-2xl font-bold text-bolt-elements-textPrimary mb-2">Cannot Spin</h1>
          <p className="text-bolt-elements-textSecondary mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <Button onClick={handleCancel} variant="secondary">
              Go Back
            </Button>
            <Button
              onClick={handleRetry}
              variant="outline"
              className="bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover border-bolt-elements-button-primary-background"
            >
              <div className="i-ph:arrow-clockwise mr-2" />
              Try Again
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  // This should not render if we reach here
  return null;
}
