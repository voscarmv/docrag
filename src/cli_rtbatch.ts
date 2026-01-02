import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

async function uploadFile(filePath: string) {
  try {
    // Create form data
    const formData = new FormData();
    
    // Read file and append to form data
    const fileStream = fs.createReadStream(filePath);
    formData.append('file', fileStream, path.basename(filePath));

    // Upload
    const response = await axios.post('http://localhost:3000/rtbatch', formData, {
      headers: {
        ...formData.getHeaders(), // Important! This sets correct Content-Type
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    console.log('Upload successful:', response.data);
    return response.data;
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
}

// Usage
if(!process.argv[2]){throw new Error('argv[2] is undefined')}
uploadFile(process.argv[2]);
