switch (
    ScribeFrame.role({
        origin: unsafeWindow.location.origin,
        top: unsafeWindow.top === unsafeWindow,
        ancestors: unsafeWindow.location.ancestorOrigins === undefined ? null : Array.from(unsafeWindow.location.ancestorOrigins),
        parented: unsafeWindow.parent !== unsafeWindow,
    })
) {
    case ScribeFrame.Role.Top:
        ScribeBoot.start({
            pageWindow: unsafeWindow,
            document,
            storage: {
                /**
                 * @param {string} name
                 * @param {*} fallback
                 * @return {*}
                 */
                get: (name, fallback) => GM_getValue(name, fallback),

                /**
                 * @param {string} name
                 * @param {*} value
                 * @return {void}
                 */
                set: (name, value) => {
                    GM_setValue(name, value);
                },

                /**
                 * @param {string} name
                 * @return {void}
                 */
                remove: (name) => {
                    GM_deleteValue(name);
                },

                /**
                 * @return {string[]}
                 */
                list: () => GM_listValues(),

                /**
                 * @param {string} name
                 * @param {() => void} changed
                 * @return {() => void}
                 */
                watch: (name, changed) => {
                    const listener = GM_addValueChangeListener(name, () => changed());
                    return () => GM_removeValueChangeListener(listener);
                },
            },
            xmlHttpRequest: GM_xmlhttpRequest,
            exporter:
                typeof exportFunction === ScribeBoot.Settings.FunctionType
                    ? /**
                       * @param {Function} wrapper
                       * @return {Function}
                       */
                      (wrapper) => exportFunction(wrapper, unsafeWindow)
                    : null,
            clone:
                typeof cloneInto === ScribeBoot.Settings.FunctionType
                    ? /**
                       * @param {*} value
                       * @return {*}
                       */
                      (value) => cloneInto(value, unsafeWindow)
                    : null,
            timers: {
                /**
                 * @param {Function} callback
                 * @param {number} delay
                 * @return {number}
                 */
                setTimeout: (callback, delay) => setTimeout(callback, delay),

                /**
                 * @param {number} timer
                 * @return {void}
                 */
                clearTimeout: (timer) => {
                    clearTimeout(timer);
                },

                /**
                 * @param {Function} callback
                 * @param {number} delay
                 * @return {number}
                 */
                setInterval: (callback, delay) => setInterval(callback, delay),

                /**
                 * @param {number} timer
                 * @return {void}
                 */
                clearInterval: (timer) => {
                    clearInterval(timer);
                },
            },
            clock: {
                /**
                 * @return {number}
                 */
                now: () => Date.now(),

                /**
                 * @return {string}
                 */
                today: () => ScribeBoot.day(new Date()),
            },
            tabId: crypto.randomUUID(),

            /**
             * @return {string}
             */
            random: () => crypto.randomUUID(),
            locks: navigator.locks ?? null,

            /**
             * @param {string} text
             * @return {boolean}
             */
            confirm: (text) => window.confirm(text),

            /**
             * @param {string} label
             * @param {Function} action
             * @return {*}
             */
            menu: (label, action) => GM_registerMenuCommand(label, action),

            /**
             * @param {string} text
             * @return {string|null}
             */
            prompt: (text) => window.prompt(text),

            /**
             * @param {string} text
             * @return {void}
             */
            alert: (text) => {
                window.alert(text);
            },

            /**
             * @param {string} name
             * @param {string} text
             * @return {void}
             */
            download: (name, text) => {
                const address = URL.createObjectURL(new Blob([text]));
                const link = document.createElement(ScribeBoot.Settings.LinkTag);
                link.href = address;
                link.download = name;
                link.click();
                setTimeout(
                    /**
                     * @return {void}
                     */
                    () => {
                        URL.revokeObjectURL(address);
                    },
                    ScribeBoot.Settings.RevokeMs,
                );
            },

            /**
             * @param {string} text
             * @return {void}
             */
            log: (text) => {
                console.warn(`${ScribeBoot.Settings.LogPrefix}${text}`);
            },
        });
        break;
    case ScribeFrame.Role.Frame:
        ScribeFrame.start({
            window: unsafeWindow,
            document,
            watch: () => ZetaSource.watch(unsafeWindow,
                typeof exportFunction === 'function' ? (wrapper) => exportFunction(wrapper, unsafeWindow) : undefined, false),

            /**
             * @return {*}
             */
            token: () => GM_getValue(ScribeFrame.Bridge.TokenName, null),
        });
        break;
    default:
        break;
}
