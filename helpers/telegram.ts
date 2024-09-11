import { logger } from "./logger";


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