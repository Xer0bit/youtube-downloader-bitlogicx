window.addEventListener('message', async (event) => {
  if (event.source !== parent) return;

  if (event.data?.type === 'YT_EVALUATOR_PING') {
    parent.postMessage({ type: 'YT_EVALUATOR_READY' }, '*');
    return;
  }

  if (event.data?.type !== 'YT_EVALUATOR_RUN') return;

  const { id, source } = event.data;
  try {
    const result = await Promise.resolve(new Function(source)());
    parent.postMessage({ type: 'YT_EVALUATOR_RESULT', id, result }, '*');
  } catch (error) {
    parent.postMessage({
      type: 'YT_EVALUATOR_RESULT',
      id,
      error: String(error?.message || error)
    }, '*');
  }
});

parent.postMessage({ type: 'YT_EVALUATOR_READY' }, '*');
