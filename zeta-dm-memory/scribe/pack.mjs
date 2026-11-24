import { closeSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const ScribePack = Object.freeze({
    Settings: Object.freeze({
        Header: 'scribe/userscript.header.txt',
        Output: 'scribe/scribe.user.js',
        TempSuffix: '.tmp',
        Encoding: 'utf8',
        LineBreak: '\n',
        CarriageReturn: /\r/g,
        ByteOrderMark: new RegExp(`^${String.fromCodePoint(0xfeff)}`),
        HeaderOpen: '// ==UserScript==',
        HeaderClose: '// ==/UserScript==',
        Opening: '(() => {',
        Strict: "'use strict';",
        Closing: '})();',
        MarkerStart: '/** @file ',
        MarkerEnd: ' */',
        Extension: '.js',
        StartName: 'ScribeStart',
        ModuleLine: /^ *(?:import|export) /m,
        ModuleCall: 'require(',
        Separators: new RegExp(`[${String.fromCodePoint(0x2028)}${String.fromCodePoint(0x2029)}]`),
        Messages: Object.freeze({
            BadHeader: 'The header is not a userscript header',
            Empty: 'A source file is empty: ',
            Module: 'A source file is a module, not a script: ',
            Undeclared: 'A source file does not declare its object: ',
            Separator: 'A source file holds a line separator the browser would break on: ',
            Compile: 'The packed script does not compile: ',
            Packed: 'Packed',
        }),
    }),

    Files: Object.freeze([
        'scribe/core/ScribeText.js',
        'scribe/core/ScribeCategory.js',
        'scribe/core/ScribeIntake.js',
        'scribe/core/ScribeAnswer.js',
        'scribe/core/ScribeLog.js',
        'scribe/core/ScribeReplay.js',
        'scribe/core/ScribeFork.js',
        'scribe/core/ScribeKnowledge.js',
        'scribe/core/ScribeAnalyzer.js',
        'scribe/core/ScribeGateway.js',
        'scribe/core/ScribeAdoption.js',
        'scribe/bench/BenchView.js',
        'scribe/page/ZetaSource.js',
        'scribe/page/ScribeStore.js',
        'scribe/page/ScribeCloud.js',
        'scribe/page/ScribeKeeper.js',
        'scribe/page/ScribeScene.js',
        'scribe/page/ScribeReminder.js',
        'scribe/page/ScribePedant.js',
        'scribe/page/ScribeMuse.js',
        'scribe/page/ScribeLive.js',
        'scribe/page/ScribeSender.js',
        'scribe/page/ScribeFrame.js',
        'scribe/page/PanelStyle.js',
        'scribe/page/PanelView.js',
        'scribe/page/ScribePanel.js',
        'scribe/page/ScribeBoot.js',
        'scribe/page/ScribeStart.js',
    ]),

    /**
     * @param {string} script
     * @return {string}
     */
    version(script) {
        const lines = script.replace(ScribePack.Settings.ByteOrderMark, '').split(/\r?\n/);
        const end = lines.indexOf(ScribePack.Settings.HeaderClose);
        const versions = lines.slice(1, end).filter((line) => /^\/\/[ \t]+@version\b/.test(line));
        const match = versions.length === 1 && /^\/\/[ \t]+@version[ \t]+((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))[ \t]*$/.exec(versions[0]);
        if (lines[0] !== ScribePack.Settings.HeaderOpen || end < 0 || !match) {
            throw new Error('Expected one numeric major.minor.patch @version in the userscript header.');
        }
        return match[1];
    },

    /**
     * @param {(relativePath: string) => string} read
     * @param {string|null} version
     * @return {string}
     * @throws {Error}
     */
    build(read, version = null) {
        const settings = ScribePack.Settings;
        const messages = settings.Messages;
        let header = read(settings.Header).replace(settings.ByteOrderMark, '').replace(settings.CarriageReturn, '');
        const headerLines = header.split(settings.LineBreak);
        if (headerLines[0] !== settings.HeaderOpen || !headerLines.includes(settings.HeaderClose)) {
            throw new Error(messages.BadHeader);
        }
        if (version !== null) {
            ScribePack.version(header);
            header = header.replace(/^(\/\/[ \t]+@version[ \t]+)\S+/m, (_, prefix) => prefix + version);
            if (ScribePack.version(header) !== version) {
                throw new Error('Invalid userscript version.');
            }
        }
        const parts = [
            header.endsWith(settings.LineBreak) ? header : `${header}${settings.LineBreak}`,
            settings.LineBreak,
            `${settings.Opening}${settings.LineBreak}`,
            `${settings.Strict}${settings.LineBreak}`,
        ];
        for (const file of ScribePack.Files) {
            const text = read(file).replace(settings.ByteOrderMark, '').replace(settings.CarriageReturn, '');
            const name = path.basename(file, settings.Extension);
            if (text.trim() === '') {
                throw new Error(`${messages.Empty}${file}`);
            }
            if (settings.ModuleLine.test(text) || text.includes(settings.ModuleCall)) {
                throw new Error(`${messages.Module}${file}`);
            }
            if (name !== settings.StartName && !new RegExp(`^const ${name} = `, 'm').test(text)) {
                throw new Error(`${messages.Undeclared}${file}`);
            }
            if (settings.Separators.test(text)) {
                throw new Error(`${messages.Separator}${file}`);
            }
            parts.push(`${settings.MarkerStart}${file}${settings.MarkerEnd}${settings.LineBreak}`);
            parts.push(text.endsWith(settings.LineBreak) ? text : `${text}${settings.LineBreak}`);
        }
        parts.push(`${settings.Closing}${settings.LineBreak}`);
        const output = parts.join('');
        try {
            new vm.Script(output);
        } catch (error) {
            throw new Error(`${messages.Compile}${error.message}`);
        }
        return output;
    },

    /**
     * @param {string} root
     * @return {{ path: string, bytes: number, files: number, version: string }}
     * @throws {Error}
     */
    write(root) {
        const settings = ScribePack.Settings;
        const read = (relativePath) => readFileSync(path.join(root, relativePath), settings.Encoding);
        const target = path.join(root, settings.Output);
        const temporary = `${target}${settings.TempSuffix}`;
        const reservation = openSync(temporary, 'wx');
        try {
            let version;
            let output;
            try {
                const minimum = ScribePack.version(read(settings.Header));
                version = minimum;
                let previous;
                try {
                    previous = ScribePack.version(read(settings.Output)).split('.').map(BigInt);
                } catch (error) {
                    if (error.code !== 'ENOENT') {
                        throw error;
                    }
                }
                if (previous) {
                    const floor = minimum.split('.').map(BigInt);
                    const difference = previous.findIndex((part, index) => part !== floor[index]);
                    if (difference < 0 || previous[difference] > floor[difference]) {
                        previous[2]++;
                        version = previous.join('.');
                    }
                }
                output = ScribePack.build(read, version);
                writeFileSync(reservation, output, settings.Encoding);
            } finally {
                closeSync(reservation);
            }
            renameSync(temporary, target);
            return { path: target, bytes: Buffer.byteLength(output, settings.Encoding), files: ScribePack.Files.length, version };
        } catch (error) {
            rmSync(temporary, { force: true });
            throw error;
        }
    },
});

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(modulePath)) {
    try {
        const result = ScribePack.write(path.resolve(path.dirname(modulePath), '..'));
        console.log(`${ScribePack.Settings.Messages.Packed} ${result.files} files, version ${result.version}, ${result.bytes} bytes: ${ScribePack.Settings.Output}`);
    } catch (error) {
        console.log(error.message);
        process.exit(1);
    }
}
