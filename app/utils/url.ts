export const changeChatUrl = (
  projectPath: string,
  option: { replace?: boolean; searchParams?: Record<string, string>; ignoreChangeEvent?: boolean } = {},
) => {
  const { replace = false, searchParams = {}, ignoreChangeEvent = false } = option;

  const queryString = new URLSearchParams(searchParams).toString();

  const appendQueryString = queryString ? `?${queryString}` : '';

  if (replace) {
    window.history.replaceState({}, '', '/chat/' + projectPath + appendQueryString);
  } else {
    window.history.pushState({}, '', '/chat/' + projectPath + appendQueryString);
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
        url: `/games/editor?chat=${encodeURIComponent(projectPath + appendQueryString)}`,
        replace,
      },
    },
    '*',
  );
};
