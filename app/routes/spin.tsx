import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from '@remix-run/react';
import { toast } from 'react-toastify';
import { motion } from 'framer-motion';
import { Button } from '~/components/ui/Button';
import { createScopedLogger } from '~/utils/logger';
import { forkProject } from '~/lib/persistenceGitbase/api.client';
import { fetchVerse, extractProjectInfoFromPlayUrl, type VerseData } from '~/lib/verse8/api';

const logger = createScopedLogger('Spin');

export default function Spin() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [verse, setVerse] = useState<VerseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);

  const fromVerse = searchParams.get('fromVerse');

  useEffect(() => {
    if (!fromVerse) {
      setError('Verse ID is required');
      setIsLoading(false);

      return;
    }

    loadVerseInfo();
  }, [fromVerse]);

  const loadVerseInfo = async () => {
    if (!fromVerse) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Fetch verse data
      const verseData = await fetchVerse(fromVerse);

      if (!verseData) {
        throw new Error('Verse not found or not accessible');
      }

      // Check if remix is allowed
      if (!verseData.allowRemix) {
        throw new Error('This verse does not allow remixing');
      }

      setVerse(verseData);
      setIsLoading(false);

      // Start creating spin immediately after a short delay for better UX
      setTimeout(() => createSpin(verseData), 500);
    } catch (error) {
      logger.error('Error loading verse info:', error);

      const errorMessage = error instanceof Error ? error.message : 'Failed to load verse information';
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  const createSpin = async (verseData: VerseData) => {
    if (!verseData || !fromVerse) {
      return;
    }

    try {
      setIsSpinning(true);
      setError(null);

      // Extract project path and SHA from playUrl
      const { projectPath, sha } = extractProjectInfoFromPlayUrl(verseData.playUrl);

      // Generate new repository name with better uniqueness
      const nameWords = verseData.title.split(/[^a-zA-Z0-9]+/).filter((word) => word.length > 0);
      let newRepoName = nameWords.join('-').toLowerCase();

      // Add timestamp and random suffix for better uniqueness
      const timestamp = Date.now().toString(36).slice(-6);
      const randomSuffix = Math.random().toString(36).slice(-3);
      newRepoName = `${newRepoName}-spin-${timestamp}${randomSuffix}`;

      // Fork the project with verse information
      const forkedProject = await forkProject(projectPath, newRepoName, sha, `Spin from ${verseData.title}`, {
        resetEnv: true,
        fromVerseId: fromVerse,
      });

      if (forkedProject && forkedProject.success) {
        toast.success('Spin created successfully!');

        // Build URL with search params (excluding 'fromVerse')
        const chatUrl = new URL(`/chat/${forkedProject.project.path}`, window.location.origin);

        // Copy all search params except 'fromVerse'
        for (const [key, value] of searchParams.entries()) {
          if (key !== 'fromVerse') {
            chatUrl.searchParams.set(key, value);
          }
        }

        // Navigate to the new project with search params
        location.href = chatUrl.toString();
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
    if (verse) {
      createSpin(verse);
    } else {
      loadVerseInfo();
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
            {isSpinning ? 'Creating a spin' : 'Loading Verse'}
          </h1>
          <p className="text-bolt-elements-textSecondary">
            {isSpinning ? `Creating your spin of "${verse?.title}"...` : 'Gathering verse details...'}
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
