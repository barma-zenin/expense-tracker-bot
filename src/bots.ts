import { Bot } from 'grammy';
import { config } from './config.js';
import { registerAdminBotHandlers } from './adminBot.js';
import { registerUserBotHandlers } from './userBot.js';

export const userBot = new Bot(config.userBotToken);
export const adminBot = new Bot(config.adminBotToken);

registerAdminBotHandlers(adminBot, userBot);
registerUserBotHandlers(adminBot, userBot);
