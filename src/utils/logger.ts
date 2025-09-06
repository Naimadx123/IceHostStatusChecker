import fs from 'fs';
import path from 'path';
import os from 'os';
import { format as utilFormat } from 'util';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type LoggerOptions = {
    dir?: string;
    prefix?: string;
    uniquePerRun?: boolean;
    mirrorToConsole?: boolean;
};

export class Logger {
    private dir: string;
    private prefix: string;
    private uniquePerRun: boolean;
    private mirrorToConsole: boolean;
    private stream: fs.WriteStream | null = null;
    private bootTime: string;
    private currentDateKey: string;
    private rotateTimer: NodeJS.Timeout | null = null;

    private originalConsole = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
    };

    constructor(opts: LoggerOptions = {}) {
        this.dir = opts.dir ?? path.resolve(process.cwd(), 'logs');
        this.prefix = opts.prefix ?? 'log';
        this.uniquePerRun = opts.uniquePerRun ?? true;
        this.mirrorToConsole = opts.mirrorToConsole ?? true;

        this.bootTime = this.timePart();
        this.currentDateKey = this.datePart();
        this.ensureDir();
        this.openStream();
        this.scheduleMidnightRotation();
        this.hookConsole();
        this.hookProcess();
    }

    public dispose() {
        console.log = this.originalConsole.log;
        console.info = this.originalConsole.info;
        console.warn = this.originalConsole.warn;
        console.error = this.originalConsole.error;
        console.debug = this.originalConsole.debug;

        if (this.rotateTimer) {
            clearTimeout(this.rotateTimer);
            this.rotateTimer = null;
        }
        this.closeStream();
    }

    private ensureDir() {
        fs.mkdirSync(this.dir, { recursive: true });
    }

    private filename(): string {
        const date = this.currentDateKey;
        if (this.uniquePerRun) {
            return `${this.prefix}-${date}_${this.bootTime}-p${process.pid}.log`;
        }
        return `${this.prefix}-${date}.log`;
    }

    private openStream() {
        const filePath = path.join(this.dir, this.filename());
        this.stream = fs.createWriteStream(filePath, { flags: 'a' });
        this.writeRaw(
            `\n===== Log started ${new Date().toISOString()} on ${os.hostname()} (pid ${process.pid}) =====\n`
        );
    }

    private closeStream() {
        if (this.stream) {
            this.writeRaw(`===== Log closed ${new Date().toISOString()} =====\n`);
            this.stream.end();
            this.stream = null;
        }
    }

    private rotateIfNeeded() {
        const nowKey = this.datePart();
        if (nowKey !== this.currentDateKey) {
            this.currentDateKey = nowKey;
            this.closeStream();
            this.openStream();
        }
    }

    private msUntilMidnight(): number {
        const now = new Date();
        const next = new Date(now);
        next.setHours(24, 0, 0, 0);
        return next.getTime() - now.getTime();
    }

    private scheduleMidnightRotation() {
        const firstIn = this.msUntilMidnight();
        this.rotateTimer = setTimeout(() => {
            this.rotateIfNeeded();
            this.rotateTimer = setInterval(() => this.rotateIfNeeded(), 24 * 60 * 60 * 1000) as any;
        }, firstIn);
    }

    private datePart(): string {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    private timePart(): string {
        const d = new Date();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${hh}${mm}${ss}`;
    }

    private writeRaw(line: string) {
        if (!this.stream) return;
        this.stream.write(line);
    }

    private write(level: ConsoleMethod, args: unknown[]) {
        const ts = new Date().toISOString();
        const msg = utilFormat(...args);
        const line = msg.endsWith('\n') ? msg : msg + '\n';
        this.writeRaw(`[${ts}] [${level.toUpperCase()}] ${line}`);
    }

    private hookConsole() {
        const self = this;

        console.log = function (...args: unknown[]) {
            if (self.mirrorToConsole) self.originalConsole.log.apply(console, args);
            self.write('log', args);
        };

        console.info = function (...args: unknown[]) {
            if (self.mirrorToConsole) self.originalConsole.info.apply(console, args);
            self.write('info', args);
        };

        console.warn = function (...args: unknown[]) {
            if (self.mirrorToConsole) self.originalConsole.warn.apply(console, args);
            self.write('warn', args);
        };

        console.error = function (...args: unknown[]) {
            if (self.mirrorToConsole) self.originalConsole.error.apply(console, args);
            self.write('error', args);
        };

        console.debug = function (...args: unknown[]) {
            if (self.mirrorToConsole) self.originalConsole.debug.apply(console, args);
            self.write('debug', args);
        };
    }

    private hookProcess() {
        process.on('uncaughtException', (err) => {
            this.write('error', ['UncaughtException:', err?.stack || String(err)]);
        });
        process.on('unhandledRejection', (reason) => {
            this.write('error', ['UnhandledRejection:', reason instanceof Error ? reason.stack : String(reason)]);
        });
        const flush = () => {
            try { this.closeStream(); } catch {}
        };
        process.on('beforeExit', flush);
        process.on('exit', flush);
        process.on('SIGINT', () => { flush(); process.exit(0); });
        process.on('SIGTERM', () => { flush(); process.exit(0); });
    }
}

export const logger = new Logger({
    dir: path.resolve(process.cwd(), 'logs'),
    prefix: 'log',
    uniquePerRun: true,
    mirrorToConsole: true,
});
