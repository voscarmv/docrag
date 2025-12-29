import axios from 'axios';
import { readFileSync } from 'fs';

const doc = './src/pg61.txt';
const text = readFileSync(doc, 'utf-8');
const API_BASE_URL = 'http://localhost:3000';

const input = text.replaceAll('\n', ' ').replaceAll('\r', ' ');

const chunkSize = 500;

(async () => {
    for (let i = 0, j = 0; i < input.length; i += chunkSize, j++) {
        const chunk = input.slice(i, i + chunkSize);
        const response = await axios.post(`${API_BASE_URL}/chunks`, {
            documentId: doc,
            chunkIndex: j,
            content: chunk
        });
        console.log(response.data);
    }
})();
