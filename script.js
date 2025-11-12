// Import các thư viện cần thiết
const axios = require('axios'); // Thư viện để gọi API
const fs = require('fs'); // Thư viện để đọc/ghi file
const path = require('path'); // Thư viện để xử lý đường dẫn file

// =================================================================
// CẤU HÌNH API
// =================================================================
const API_HISTORY_URL = "https://cmangax8.com/api/data?data=game_data";
const API_ANGEL_URL = "https://cmangax8.com/api/score_list?type=ad_angel&limit=1000";
const API_DEVIL_URL = "https://cmangax8.com/api/score_list?type=ad_devil&limit=1000";
const API_GEMS_URL = "https://cmangax8.com/api/ad_request_remain";

// Tên file để lưu trữ
const HISTORY_FILE_PATH = path.join(__dirname, 'history.json');

// =================================================================
// HÀM HỖ TRỢ (Lấy từ file HTML của bạn)
// =================================================================

// Hàm "Làm phẳng" danh sách đóng góp
function processContributionList(data) {
    if (!Array.isArray(data)) {
        console.error("Dữ liệu đóng góp không phải là mảng:", data);
        return [];
    }
    return data.map(item => {
        try {
            const info = JSON.parse(item.info);
            return {
                name: info.name,
                score: parseInt(item.score, 10),
                guild: info.guild ? info.guild.name : "N/A"
            };
        } catch (e) {
            console.error("Lỗi parse item.info:", item.info, e);
            return { name: "Lỗi Parse", score: 0, guild: "N/A" };
        }
    }).sort((a, b) => b.score - a.score); // Sắp xếp điểm giảm dần
}

// Hàm gọi API (thêm try-catch để an toàn)
async function fetchApi(url) {
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error(`Lỗi khi gọi API ${url}:`, error.message);
        return null; // Trả về null nếu lỗi
    }
}

// =================================================================
// LOGIC CHÍNH
// =================================================================

/**
 * Đọc file history.json hiện có
 */
function readHistoryFile() {
    if (fs.existsSync(HISTORY_FILE_PATH)) {
        try {
            const fileContent = fs.readFileSync(HISTORY_FILE_PATH, 'utf8');
            return JSON.parse(fileContent);
        } catch (e) {
            console.error("Lỗi đọc hoặc parse file history.json:", e);
            return []; // Trả về mảng rỗng nếu file lỗi
        }
    }
    return []; // Trả về mảng rỗng nếu file không tồn tại
}

/**
 * Ghi đè dữ liệu mới vào file history.json
 */
function writeHistoryFile(data) {
    try {
        // Sắp xếp lại theo STT giảm dần (mới nhất lên đầu) trước khi ghi
        data.sort((a, b) => b.STT - a.STT);
        const fileContent = JSON.stringify(data, null, 2); // Định dạng JSON cho đẹp
        fs.writeFileSync(HISTORY_FILE_PATH, fileContent, 'utf8');
        console.log(`Đã ghi thành công ${data.length} bản ghi vào history.json`);
    } catch (e) {
        console.error("Lỗi ghi file history.json:", e);
    }
}

/**
 * (Logic của bạn) Cập nhật kết quả từ API Lịch sử vào file
 */
async function updateResultsFromApi(storedHistory) {
    console.log("Đang gọi API Lịch sử để cập nhật kết quả cũ...");
    const apiHistoryData = await fetchApi(API_HISTORY_URL);

    if (!apiHistoryData || !apiHistoryData.angel_devil || !apiHistoryData.angel_devil.history) {
        console.log("Không có dữ liệu lịch sử từ API, bỏ qua cập nhật.");
        return;
    }

    const historyFromApi = apiHistoryData.angel_devil.history;
    let hasUpdated = false;

    // Chuyển đổi dữ liệu API để dễ tra cứu
    const processedApiHistory = Object.keys(historyFromApi).map(hourKey => {
        const match = historyFromApi[hourKey];
        const matchTime = new Date(match.time);
        const ID_Battle = `${matchTime.getFullYear()}${String(matchTime.getMonth() + 1).padStart(2, '0')}${String(matchTime.getDate()).padStart(2, '0')}_${String(matchTime.getHours()).padStart(2, '0')}`;
        return {
            ID_Battle: ID_Battle,
            team: match.team,
            total: match.total
        };
    });

    // Duyệt qua lịch sử đã lưu
    storedHistory.forEach(record => {
        // Chỉ cập nhật nếu chưa có phe chiến thắng
        if (record.ID_Battle && !record.PheChienThang) {
            const apiMatch = processedApiHistory.find(apiRec => apiRec.ID_Battle === record.ID_Battle);
            if (apiMatch) {
                record.PheChienThang = apiMatch.team;
                record.TongVangThang = apiMatch.total;
                hasUpdated = true;
                console.log(`Cập nhật kết quả cho trận ${record.ID_Battle}`);
            }
        }
    });

    if (hasUpdated) {
        console.log("Đã cập nhật kết quả các trận cũ.");
    } else {
        console.log("Không có trận nào cần cập nhật.");
    }
}

/**
 * (Logic của bạn) Thêm bản ghi dự báo cho trận SẮP TỚI
 */
async function addNewBattleRecord(storedHistory) {
    console.log("Đang gọi 3 API (Angel, Devil, Gems) để lấy dự báo trận mới...");
    
    // Gọi 3 API cùng lúc
    const [angelData, devilData, gemsData] = await Promise.all([
        fetchApi(API_ANGEL_URL),
        fetchApi(API_DEVIL_URL),
        fetchApi(API_GEMS_URL)
    ]);

    // Nếu 1 trong 3 API lỗi, dừng lại
    if (!angelData || !devilData || !gemsData) {
        console.error("Lỗi khi gọi 1 trong 3 API, không thể thêm bản ghi mới.");
        return;
    }

    // 2. Xử lý dữ liệu (tính tổng)
    const totalAngelScore = processContributionList(angelData).reduce((sum, item) => sum + item.score, 0);
    const totalDevilScore = processContributionList(devilData).reduce((sum, item) => sum + item.score, 0);

    // 3. Chuẩn bị dữ liệu để lưu (cho GIỜ TIẾP THEO)
    const now = new Date();
    const battleTime = new Date(now.getTime() + 3600 * 1000); // +1 giờ
    battleTime.setMinutes(0, 0, 0); // Đặt về 00:00:00

    const battleHour = battleTime.getHours();
    const battleDate = `${String(battleTime.getDate()).padStart(2, '0')}/${String(battleTime.getMonth() + 1).padStart(2, '0')}`;
    const ID_Battle = `${battleTime.getFullYear()}${String(battleTime.getMonth() + 1).padStart(2, '0')}${String(battleTime.getDate()).padStart(2, '0')}_${String(battleHour).padStart(2, '0')}`;

    // 4. Kiểm tra xem ID_Battle đã tồn tại chưa
    const existingRecord = storedHistory.find(rec => rec.ID_Battle === ID_Battle);
    if (existingRecord) {
        console.log(`Trận ${ID_Battle} đã tồn tại trong file. Bỏ qua.`);
        return; // Đã tồn tại, không làm gì
    }

    // 5. Tạo bản ghi mới
    const newRecord = {
        STT: storedHistory.length > 0 ? Math.max(...storedHistory.map(r => r.STT)) + 1 : 1,
        ID_Battle: ID_Battle,
        Ngay: battleDate,
        Gio: `${String(battleHour).padStart(2, '0')}:00`,
        TongVangTien: totalAngelScore,
        TongVangMa: totalDevilScore,
        LinhThachTien: gemsData.devil || 0, // LT trừ Tiên
        LinhThachMa: gemsData.angel || 0,   // LT trừ Ma
        PheChienThang: "", // Sẽ được cập nhật ở lần chạy sau
        TongVangThang: 0   // Sẽ được cập nhật ở lần chạy sau
    };

    // 6. Thêm vào mảng
    storedHistory.push(newRecord);
    console.log(`Đã thêm dự báo cho trận ${ID_Battle}.`);
}


/**
 * HÀM CHẠY CHÍNH
 */
async function main() {
    console.log("Bắt đầu quy trình thu thập dữ liệu...");
    
    // 1. Đọc dữ liệu cũ
    let historyData = readHistoryFile();

    // 2. Cập nhật kết quả cho các trận cũ (dùng API History)
    // Chúng ta làm việc này TRƯỚC khi thêm trận mới
    await updateResultsFromApi(historyData);

    // 3. Thêm dự báo cho trận sắp tới (dùng API Angel/Devil/Gems)
    await addNewBattleRecord(historyData);

    // 4. Lưu tất cả thay đổi vào file
    writeHistoryFile(historyData);

    console.log("Quy trình hoàn tất.");
}

// Chạy hàm main
main();
