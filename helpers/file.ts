import { promises as fs } from 'fs';
import { promises as fsPromises } from 'fs';

export async function saveToFile(fileName: string, data: string) {
    try {
      await fs.writeFile(fileName, data);
      console.log(`Write token data success : ${fileName}`);
    } catch (err) {
      console.error(`Write token data fail : ${fileName}`, err);
    }
}
  
export async function appendToFile(fileName: string, data: string) {
  try {
    await fsPromises.appendFile(fileName, data);
    console.log('Data successfully appended!');
  } catch (err) {
    console.error('Error appending data:', err);
  }
}