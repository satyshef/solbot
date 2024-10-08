import { logger } from "./logger";
const { parentPort } = require('worker_threads');

interface WorkerData {
    chatID: string;
    token: string;
    message: string;
}

if (parentPort) {
    try{
        parentPort.on('message', (data: WorkerData) => {
            const result = sendTelegramMessage(data.chatID, data.token, data.message);
        });
    } catch (error) {
        console.error('Error in telegram worker:', error);
    }
} else {
    console.error('Telegram script is not running inside a worker.');
}

export async function sendTelegramMessage(chatID:string, token:string, message: string): Promise<Boolean> {

    const url = `https://api.telegram.org/bot${token}/sendMessage`
    const data = {
        chat_id: chatID,
        text: message,
        disable_web_page_preview: true,
      };


    const response = fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });
    //.then(response => response.json())
    //.then(result => console.log('Успех:', result))
    //.catch(error => console.error('Ошибка:', error));
    logger.trace(`SENT MESSAGE : ${message}`)
    logger.trace(response)
    return false;
}