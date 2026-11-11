// Generates a deterministic, synthetic SillyTavern data root for benchmarking.
// Synthetic only: never point this at real user data.
//
// Usage: node bench/generate-data.mjs --out <dir> [--characters 1000] [--chats-per-char 10]
//        [--messages 300] [--big-chats 5] [--big-messages 5000] [--avatar <png>] [--seed 1]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { write as writeCard } from '../src/character-card-parser.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const out = path.resolve(String(args.out ?? ''));
if (!args.out) {
    console.error('--out <dir> is required');
    process.exit(1);
}
const N_CHARS = Number(args.characters ?? 1000);
const CHATS_PER_CHAR = Number(args['chats-per-char'] ?? 10);
const MESSAGES = Number(args.messages ?? 300);
const BIG_CHATS = Number(args['big-chats'] ?? 5);
const BIG_MESSAGES = Number(args['big-messages'] ?? 5000);
const avatarPath = path.resolve(String(args.avatar ?? path.join(root, 'default/content/default_Seraphina.png')));
const rand = mulberry32(Number(args.seed ?? 1));

const WORDS = 'the of and to in a is that for it as was with be by on not he this are or his from at which but have an had they you were their one all we can her has there been if more when will would who so no'.split(' ');
const sentence = (n) => Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(' ');
const paragraph = (chars) => { let s = ''; while (s.length < chars) s += sentence(8 + Math.floor(rand() * 12)) + '. '; return s.slice(0, chars); };

const userDir = path.join(out, 'default-user');
const charsDir = path.join(userDir, 'characters');
const chatsDir = path.join(userDir, 'chats');
fs.mkdirSync(charsDir, { recursive: true });
fs.mkdirSync(chatsDir, { recursive: true });
const avatar = fs.readFileSync(avatarPath);

let chatBytes = 0;
let chatCount = 0;
const started = Date.now();

for (let i = 0; i < N_CHARS; i++) {
    const name = `Bench Character ${String(i).padStart(5, '0')}`;
    const data = {
        name, description: paragraph(1500), personality: paragraph(400), scenario: paragraph(400),
        first_mes: paragraph(600), mes_example: paragraph(1200), creator_notes: paragraph(300),
        system_prompt: '', post_history_instructions: '', alternate_greetings: [paragraph(300), paragraph(300)],
        tags: ['bench', `group${i % 20}`], creator: 'bench', character_version: '1.0', extensions: {},
    };
    const card = { ...data, spec: 'chara_card_v2', spec_version: '2.0', data: { ...data, character_book: undefined }, create_date: new Date(1.7e12 + i * 1e6).toISOString() };
    fs.writeFileSync(path.join(charsDir, `${name}.png`), writeCard(avatar, JSON.stringify(card)));

    const chatDir = path.join(chatsDir, name);
    fs.mkdirSync(chatDir, { recursive: true });
    const isBig = i < BIG_CHATS;
    const nChats = isBig ? 1 : CHATS_PER_CHAR;
    for (let c = 0; c < nChats; c++) {
        const msgs = isBig ? BIG_MESSAGES : MESSAGES;
        const bytes = writeChat(path.join(chatDir, `${name} - chat ${c}.jsonl`), name, msgs, isBig ? 3000 : 600);
        chatBytes += bytes;
        chatCount++;
    }
}

console.log(JSON.stringify({ out, characters: N_CHARS, chats: chatCount, chatMB: +(chatBytes / 1048576).toFixed(1), seconds: +((Date.now() - started) / 1000).toFixed(1) }));

function writeChat(file, charName, count, avgChars) {
    const header = { chat_metadata: { integrity: `bench-${path.basename(file)}`, chat_id_hash: 0 }, user_name: 'User', character_name: charName, create_date: '2026-1-1 @00h 00m 00s 000ms' };
    const lines = [JSON.stringify(header)];
    for (let m = 0; m < count; m++) {
        const isUser = m % 2 === 1;
        lines.push(JSON.stringify({
            name: isUser ? 'User' : charName, is_user: isUser, is_system: false,
            send_date: new Date(1.7e12 + m * 60000).toISOString(),
            mes: paragraph(Math.floor(avgChars * (0.4 + rand() * 1.2))), extra: {},
        }));
    }
    const text = lines.join('\n');
    fs.writeFileSync(file, text);
    return text.length;
}

function parseArgs(argv) {
    const o = {};
    for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    return o;
}
function mulberry32(a) {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
