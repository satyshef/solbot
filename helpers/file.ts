import { promises as fs } from 'fs';

export async function saveToFile(fileName: string, data: string) {
    try {
      await fs.writeFile(fileName, data);
      console.log(`Write token data success : ${fileName}`);
    } catch (err) {
      console.error(`Write token data fail : ${fileName}`, err);
    }
  }
  