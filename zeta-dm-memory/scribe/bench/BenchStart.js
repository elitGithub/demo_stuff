BenchPage.start({
    document,
    fetch: window.fetch.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    setTimeout: window.setTimeout.bind(window),
    confirm: window.confirm.bind(window),
    now: Date.now,
    AbortController: window.AbortController,
});
