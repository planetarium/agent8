export const changeChatUrl = (
  projectPath: string,
  option: { replace?: boolean; searchParams?: Record<string, string>; ignoreChangeEvent?: boolean } = {},
) => {
  const { replace = false, searchParams = {}, ignoreChangeEvent = false } = option;

  const queryString = new URLSearchParams(searchParams).toString();

  const appendQueryString = queryString ? `?${queryString}` : '';

  const url = projectPath && projectPath !== '/' ? '/chat/' + projectPath + appendQueryString : '/';

  if (replace) {
    window.history.replaceState({}, '', url);
  } else {
    window.history.pushState({}, '', url);
  }

  if (!ignoreChangeEvent) {
    window.dispatchEvent(
      new CustomEvent('urlchange', {
        detail: { url: window.location.href },
      }),
    );
  }

  window.parent.postMessage(
    {
      type: 'UPDATE_URL',
      payload: {
        url: `/creator/editor?chat=${encodeURIComponent(projectPath + appendQueryString)}`,
        replace,
      },
    },
    '*',
  );
};
