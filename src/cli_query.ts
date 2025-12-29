import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000';

(async () => {
        const response = await axios.get(`${API_BASE_URL}/chunks/${process.argv[2]}`);
        console.log(response.data);
})();
