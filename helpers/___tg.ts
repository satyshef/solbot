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

async function sendTelegramMessage(chatID:string, token:string, message: string): Promise<Boolean> {

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

    console.log(`SENT TG MESSAGE : ${message}`)
    if ((await response).ok) {
        return true;
    }
    console.log(response)
    return false;
}
  