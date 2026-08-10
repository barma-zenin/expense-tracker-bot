import { Bot } from 'grammy';
import { config } from './config';
import { registerAdminBotHandlers } from './adminBot';
import { registerUserBotHandlers } from './userBot';

export const userBot = new Bot(config.userBotToken);
export const adminBot = new Bot(config.adminBotToken);

registerAdminBotHandlers(adminBot, userBot);
registerUserBotHandlers(adminBot, userBot);
