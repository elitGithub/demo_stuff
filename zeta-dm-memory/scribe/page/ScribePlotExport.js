const ScribePlotExport = Object.freeze({
    Settings: Object.freeze({
        HostId: 'scribe-plot-host',
        ButtonId: 'scribe-plot-export-button',
        StatusId: 'scribe-plot-export-status',
        ShadowMode: 'closed',
        ButtonType: 'button',
        Polite: 'polite',
        ClickEvent: 'click',
        AbortError: 'AbortError',
        Locale: 'en-US',
        NoLoginMessage: 'No login seen yet',
        JsonIndent: 2,
        Zero: 0,
        Single: 1,
        Nothing: '',
        ObjectType: 'object',
        StringType: 'string',
        FunctionType: 'function',
        Tags: Object.freeze({
            Block: 'div',
            Style: 'style',
            Button: 'button',
            Paragraph: 'p',
        }),
        Classes: Object.freeze({
            Container: 'plot-export',
            Button: 'plot-export-button',
            Status: 'plot-export-status',
            Error: 'error',
        }),
        Attributes: Object.freeze({
            Type: 'type',
            Live: 'aria-live',
        }),
        Words: Object.freeze({
            Export: 'Export plot',
            Exporting: 'Exporting plot...',
            Exported: 'Exported ',
            NoLogin: 'No login seen yet — wait a moment or refresh, then try again.',
            NoPlot: 'Zeta named no story for this chat',
            CharacterOne: ' character',
            CharacterMany: ' characters',
            LoreOne: ' lore entry',
            LoreMany: ' lore entries',
            Open: ' (',
            Comma: ', ',
            Close: ').',
            Unknown: 'Something went wrong.',
        }),
    }),

    /**
     * @param {*} error
     * @return {string}
     */
    reason(error) {
        const settings = ScribePlotExport.Settings;
        const words = settings.Words;
        const noLogin =
            typeof ZetaSource !== 'undefined' &&
            typeof ZetaSource?.Settings?.Messages?.NoLogin === settings.StringType
                ? ZetaSource.Settings.Messages.NoLogin
                : settings.NoLoginMessage;
        try {
            const described =
                error !== null &&
                typeof error === settings.ObjectType &&
                typeof error.message === settings.StringType &&
                error.message !== settings.Nothing;
            const text = described ? error.message : String(error);
            return text === noLogin ? words.NoLogin : text;
        } catch {
            return words.Unknown;
        }
    },

    /**
     * @param {{ document: object, AbortController?: Function|null, plotId: string, fetchPlot: (signal: AbortSignal|null) => Promise<object>, download: (name: string, text: string) => void, clock: { now: () => number } }} environment
     * @return {Readonly<{ host: object, unmount: () => void }>}
     */
    mount(environment) {
        const settings = ScribePlotExport.Settings;
        const tags = settings.Tags;
        const classes = settings.Classes;
        const attributes = settings.Attributes;
        const words = settings.Words;
        const { document, AbortController = null, plotId, fetchPlot, download, clock } = environment;
        if (typeof document.getElementById === settings.FunctionType) {
            const earlier = document.getElementById(settings.HostId);
            if (earlier !== null) {
                earlier.remove();
            }
        }
        const host = document.createElement(tags.Block);
        host.id = settings.HostId;
        const root = host.attachShadow({ mode: settings.ShadowMode });
        const style = document.createElement(tags.Style);
        style.textContent = PanelStyle.PlotText;
        const container = document.createElement(tags.Block);
        container.classList.add(classes.Container);
        const button = document.createElement(tags.Button);
        button.id = settings.ButtonId;
        button.setAttribute(attributes.Type, settings.ButtonType);
        button.classList.add(classes.Button);
        button.textContent = words.Export;
        const status = document.createElement(tags.Paragraph);
        status.id = settings.StatusId;
        status.setAttribute(attributes.Live, settings.Polite);
        status.classList.add(classes.Status);
        status.hidden = true;
        container.append(button, status);
        root.append(style, container);
        document.body.append(host);
        let busy = false;
        let unmounted = false;
        let controller = null;

        /**
         * @return {Promise<void>}
         */
        const onClick = async () => {
            if (busy || unmounted) {
                return;
            }
            busy = true;
            button.disabled = true;
            status.hidden = false;
            status.classList.remove(classes.Error);
            status.textContent = words.Exporting;
            const active = typeof AbortController === settings.FunctionType ? new AbortController() : null;
            controller = active;
            try {
                const plot = await fetchPlot(active === null ? null : active.signal);
                if (unmounted) {
                    return;
                }
                if (
                    plot === null ||
                    typeof plot !== settings.ObjectType ||
                    Array.isArray(plot) ||
                    typeof plot.plotId !== settings.StringType ||
                    plot.plotId.trim() === settings.Nothing
                ) {
                    const noPlot =
                        typeof ZetaSource !== 'undefined' &&
                        typeof ZetaSource?.Settings?.Messages?.NoPlot === settings.StringType
                            ? ZetaSource.Settings.Messages.NoPlot
                            : words.NoPlot;
                    throw new Error(noPlot);
                }
                const exportedAt = new Date(clock.now()).toISOString();
                const bundle = ScribeSetup.exportBundle({ plot, exportedAt });
                const filename = ScribeSetup.filename(plot?.name, plot?.plotId ?? plotId);
                download(filename, JSON.stringify(bundle, null, settings.JsonIndent));
                const characterCount = Array.isArray(bundle.plot?.characters) ? bundle.plot.characters.length : settings.Zero;
                const loreCount = Array.isArray(bundle.plot?.lore) ? bundle.plot.lore.length : settings.Zero;
                const characterWord = characterCount === settings.Single ? words.CharacterOne : words.CharacterMany;
                const loreWord = loreCount === settings.Single ? words.LoreOne : words.LoreMany;
                status.classList.remove(classes.Error);
                status.hidden = false;
                status.textContent =
                    words.Exported +
                    filename +
                    words.Open +
                    characterCount.toLocaleString(settings.Locale) +
                    characterWord +
                    words.Comma +
                    loreCount.toLocaleString(settings.Locale) +
                    loreWord +
                    words.Close;
            } catch (error) {
                if (unmounted) {
                    return;
                }
                if (error?.name === settings.AbortError) {
                    status.classList.remove(classes.Error);
                    status.textContent = settings.Nothing;
                    status.hidden = true;
                    return;
                }
                status.classList.add(classes.Error);
                status.hidden = false;
                status.textContent = ScribePlotExport.reason(error);
            } finally {
                if (controller === active) {
                    controller = null;
                }
                busy = false;
                if (!unmounted) {
                    button.disabled = false;
                }
            }
        };
        button.addEventListener(settings.ClickEvent, onClick);
        return Object.freeze({
            host,
            /**
             * @return {void}
             */
            unmount: () => {
                if (unmounted) {
                    return;
                }
                unmounted = true;
                if (controller !== null) {
                    const active = controller;
                    controller = null;
                    active.abort();
                }
                host.remove();
            },
        });
    },
});
