export default class WholeModel {
    static Endpoint = 'https://openrouter.ai/api/v1/chat/completions';

    static MostCalls = 120;

    /**
     * @param {Map<string, string>} prompts
     * @param {Object<string, (user: string) => string>} answers
     * @param {Object<string, number>} costs
     */
    constructor(prompts, answers, costs) {
        this.prompts = prompts;
        this.answers = { ...answers };
        this.costs = { ...costs };
        this.calls = [];
        this.strays = [];
        this.silenced = 0;
        this.watch = null;
        this.holding = null;
    }

    /**
     * @param {string} system
     * @return {string}
     */
    roleOf(system) {
        return this.prompts.get(system) ?? 'Unknown';
    }

    /**
     * @param {string} content
     * @param {number} cost
     * @return {string}
     */
    static completion(content, cost) {
        return JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content } }],
            usage: { prompt_tokens: 120, completion_tokens: 30, cost },
        });
    }

    /**
     * @param {{ name: string, dead: boolean, clock: { now: () => number } }} tab
     * @param {object} details
     * @return {{ abort: () => void }}
     */
    request(tab, details) {
        const call = {
            tab: tab.name,
            at: tab.clock.now(),
            url: String(details.url),
            method: String(details.method),
            authorization: details.headers?.Authorization ?? null,
            headers: JSON.stringify(details.headers ?? {}),
            data: typeof details.data === 'string' ? details.data : '',
            model: null,
            role: 'Unknown',
            system: '',
            user: '',
            ended: false,
        };
        const handle = {
            /**
             * @return {void}
             */
            abort: () => {
                if (!call.ended) {
                    call.ended = true;
                    details.onabort({ status: 0 });
                }
            },
        };
        if (call.url !== WholeModel.Endpoint) {
            this.strays.push(call.url);
            Promise.resolve().then(() => {
                call.ended = true;
                details.onerror({ status: 0 });
            });
            return handle;
        }
        try {
            const body = JSON.parse(call.data);
            call.model = body.model;
            call.system = body.messages[0].content;
            call.user = body.messages[1].content;
        } catch {
            call.system = '';
        }
        call.role = this.roleOf(call.system);
        this.calls.push(call);
        if (this.watch !== null) {
            this.watch(call);
        }
        if (this.calls.length > WholeModel.MostCalls) {
            this.silenced++;
            return handle;
        }
        if (call.role === this.holding) {
            return handle;
        }
        const answer = Object.hasOwn(this.answers, call.role) ? this.answers[call.role] : null;
        const cost = Object.hasOwn(this.costs, call.role) ? this.costs[call.role] : 0;
        Promise.resolve().then(() => {
            if (call.ended || tab.dead) {
                return;
            }
            call.ended = true;
            if (answer === null) {
                details.onload({ status: 400, responseText: '{"error":{"code":400,"message":"unknown prompt"}}' });
                return;
            }
            details.onload({ status: 200, responseText: WholeModel.completion(answer(call.user), cost) });
        });
        return handle;
    }

    /**
     * @param {string} role
     * @return {object[]}
     */
    of(role) {
        return this.calls.filter((call) => call.role === role);
    }

    /**
     * @param {string} tab
     * @return {object[]}
     */
    by(tab) {
        return this.calls.filter((call) => call.tab === tab);
    }
}
