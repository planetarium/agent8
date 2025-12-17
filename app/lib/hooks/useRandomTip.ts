import { useState } from 'react';

// Game creation tips
const gameCreationTips = [
  'Does the game run in preview but fail after launch? Tell the AI, "It runs fine in preview, but it doesn\'t work after deployment. Please fix it," then try launching again.',
  'In your first request, say, "Split the code into smaller files so one file doesn\'t get too long." This usually increases success rates.',
  'Each AI model works differently. Try a few models and pick the one that fits you.',
  'When adding images, include emojis in your description or attach reference images - the AI will understand you better.',
  'Want to change the sky in your game? Ask to replace the skybox with your preferred style.',
  'Include the name of a reference game in your first prompt.',
  'When adding a cinematic video, attach photos or captured scenes that match the style you want for better results.',
  'Want it playable on smartphones? Ask, "Recompose the layout for mobile devices."',
  'Add a leaderboard so players can show off their scores!',
  "Create a game that can save the progress. Verse8's backend development system makes it easy.",
  'When implementing mechanics, explain step by step; examples or descriptions help a lot.',
  'If you have experience, use game-dev terms in your prompts - the AI will follow more easily.',
  'If an error occurs, capture the screen or exact error message and send it to the AI for faster fixes.',
  'Write requirements in detail and include examples.',
  'For complex requests, add "Proceed step-by-step" so the AI can handle them gradually.',
  'If you need collisions for characters and walls, say "Set accurate collision bounds."',
];

/**
 * Hook that returns a random game creation tip.
 * The tip is selected once when the component mounts and remains the same during re-renders.
 */
export function useRandomTip(): string {
  const [tip] = useState(() => gameCreationTips[Math.floor(Math.random() * gameCreationTips.length)]);
  return tip;
}

export default useRandomTip;
