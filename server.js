require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const screenshotDir = path.join(__dirname, 'public/screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

const screenshotStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/screenshots/'),
    filename: (req, file, cb) => {
        const code = req.body.device_id || 'unknown';
        const date = new Date();
        const timeStr = date.toISOString().slice(0, 19).replace(/[-T:]/g, "");
        cb(null, `${code}_${timeStr}.png`);
    }
});
const uploadScreenshot = multer({ storage: screenshotStorage });

// --- 1. DISPLAY (DEVICE) ---
app.get('/api/displays', (req, res) => {
    const sql = `SELECT *, IF(last_seen > DATE_SUB(NOW(), INTERVAL 1 MINUTE), 1, 0) as is_online FROM devices WHERE device_code != 'PREVIEW_BOX' ORDER BY name ASC`;
    db.query(sql, (err, rows) => res.json(rows));
});
app.put('/api/displays/:id', (req, res) => {
    db.query('UPDATE devices SET name = ?, device_code = ?, orientation = ?, default_layout_id = ? WHERE id = ?', [req.body.name, req.body.device_code, req.body.orientation, req.body.default_layout_id || null, req.params.id], (e) => res.json({ success: !e }));
});
app.delete('/api/displays/:id', (req, res) => {
    const deviceId = req.params.id;

    // Bước 1: Xóa thiết bị khỏi các Group (thủ tục chuẩn)
    db.query('DELETE FROM group_members WHERE device_id = ?', [deviceId], (err) => {
        if (err) console.error("Lỗi xóa group member:", err);

        // Bước 2: Tìm những Lịch (Schedule) mà thiết bị này là mục tiêu DUY NHẤT
        // Logic: Group by ID lịch, đếm số lượng target = 1, và target đó chính là thiết bị này
        const sqlFindOrphans = `
            SELECT schedule_id 
            FROM schedule_targets 
            GROUP BY schedule_id 
            HAVING COUNT(*) = 1 
            AND SUM(target_type = 'device' AND target_id = ?) = 1
        `;

        db.query(sqlFindOrphans, [deviceId], (err, rows) => {
            if (err) console.error("Lỗi tìm lịch mồ côi:", err);

            // Lấy ra danh sách ID các lịch cần xóa vĩnh viễn
            const schedulesToDelete = rows ? rows.map(r => r.schedule_id) : [];

            // Bước 3: Xóa liên kết trong bảng schedule_targets
            // (Thao tác này sẽ gỡ thiết bị khỏi TẤT CẢ các lịch, kể cả lịch chung hay riêng)
            db.query("DELETE FROM schedule_targets WHERE target_type = 'device' AND target_id = ?", [deviceId], (err) => {
                if (err) console.error("Lỗi xóa target:", err);

                // Bước 4: Xóa các Lịch (Schedules) đã được xác định ở Bước 2 (Lịch chỉ có 1 mình nó)
                if (schedulesToDelete.length > 0) {
                    db.query('DELETE FROM schedules WHERE id IN (?)', [schedulesToDelete], (err) => {
                        if (err) console.error("Lỗi xóa lịch rỗng:", err);
                    });
                }

                // Bước 5: Cuối cùng xóa Thiết bị
                db.query('DELETE FROM devices WHERE id = ?', [deviceId], (e) => {
                    res.json({ success: !e });
                });
            });
        });
    });
});
app.put('/api/displays/:id/approve', (req, res) => db.query('UPDATE devices SET status = 1 WHERE id = ?', [req.params.id], (e) => res.json({ success: !e })));
app.post('/api/displays/:id/command', (req, res) => db.query('UPDATE devices SET pending_command = ? WHERE id = ?', [req.body.cmd, req.params.id], (e) => res.json({ success: !e })));

app.post('/api/displays/screenshot/upload', uploadScreenshot.single('file'), (req, res) => {
    const deviceCode = req.body.device_id;
    if (!req.file || !deviceCode) return res.json({ success: false });
    const webPath = '/screenshots/' + req.file.filename;
    db.query('UPDATE devices SET last_screenshot_path = ? WHERE device_code = ?', [webPath, deviceCode], (e) => res.json({ success: true, path: webPath }));
});

// --- 2. GROUPS ---
app.get('/api/groups', (req, res) => {
    const sql = `SELECT g.*, GROUP_CONCAT(d.name SEPARATOR ', ') as member_names FROM display_groups g LEFT JOIN group_members gm ON g.id = gm.group_id LEFT JOIN devices d ON gm.device_id = d.id GROUP BY g.id`;
    db.query(sql, (e, r) => res.json(r));
});
app.post('/api/groups', (req, res) => db.query('INSERT INTO display_groups (name) VALUES (?)', [req.body.name], (e) => res.json({ success: !e })));
app.put('/api/groups/:id', (req, res) => db.query('UPDATE display_groups SET name = ? WHERE id = ?', [req.body.name, req.params.id], (e) => res.json({ success: !e })));
app.delete('/api/groups/:id', (req, res) => db.query('DELETE FROM display_groups WHERE id = ?', [req.params.id], (e) => res.json({ success: !e })));
app.get('/api/groups/:id/members', (req, res) => db.query('SELECT d.* FROM devices d JOIN group_members gm ON d.id = gm.device_id WHERE gm.group_id = ?', [req.params.id], (e, r) => res.json(r)));
app.post('/api/groups/add-member', (req, res) => {
    db.query('DELETE FROM group_members WHERE group_id=? AND device_id=?', [req.body.group_id, req.body.device_id], () => {
        db.query('INSERT INTO group_members (group_id, device_id) VALUES (?, ?)', [req.body.group_id, req.body.device_id], (e) => res.json({ success: !e }));
    });
});
app.delete('/api/groups/:gid/members/:did', (req, res) => db.query('DELETE FROM group_members WHERE group_id=? AND device_id=?', [req.params.gid, req.params.did], (e) => res.json({ success: !e })));

// --- 3. MEDIA ---
app.post('/api/media/upload', upload.single('file'), (req, res) => {
    const { type, url, name, duration, scale } = req.body;
    let filePath = url; let fileSize = 0;
    if (req.file) {
        const ext = path.extname(req.file.originalname).toLowerCase();
        if ((type === 'image' && !['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) || (type === 'video' && !['.mp4'].includes(ext))) {
            fs.unlinkSync(req.file.path); return res.json({ success: false, error: 'Sai định dạng' });
        }
        filePath = '/uploads/' + req.file.filename; fileSize = req.file.size;
    }
    db.query('INSERT INTO media (name, type, path, duration, scale, size) VALUES (?, ?, ?, ?, ?, ?)', [name, type, filePath, duration, scale || 100, fileSize], (e) => res.json({ success: !e }));
});
app.put('/api/media/:id', upload.single('file'), (req, res) => {
    const { type, url, name, duration, scale } = req.body;
    let sql = 'UPDATE media SET name=?, duration=?, type=?, scale=?';
    let params = [name, duration, type, scale || 100];
    if (req.file) { sql += ', path=?, size=?'; params.push('/uploads/' + req.file.filename); params.push(req.file.size); }
    else if (url) { sql += ', path=?'; params.push(url); }
    sql += ' WHERE id=?'; params.push(req.params.id);
    db.query(sql, params, (e) => res.json({ success: !e }));
});
app.get('/api/media', (req, res) => db.query('SELECT * FROM media ORDER BY id DESC', (e, r) => res.json(r)));
app.delete('/api/media/:id', (req, res) => {
    const sqlCheck = `SELECT DISTINCT l.name FROM layout_items li JOIN layouts l ON li.layout_id = l.id WHERE li.media_id = ?`;
    db.query(sqlCheck, [req.params.id], (err, rows) => {
        if (rows.length > 0) return res.status(400).json({ error: `Media đang được dùng trong: ${rows.map(r => r.name).join(', ')}` });
        db.query('SELECT path, type FROM media WHERE id = ?', [req.params.id], (err, mediaRows) => {
            if (mediaRows.length && mediaRows[0].type !== 'website') {
                const realPath = path.join(__dirname, 'public', mediaRows[0].path);
                if (fs.existsSync(realPath)) fs.unlinkSync(realPath);
            }
            db.query('DELETE FROM media WHERE id = ?', [req.params.id], (e) => res.json({ success: !e }));
        });
    });
});
app.post('/api/media/unlink/:id', (req, res) => db.query('DELETE FROM layout_items WHERE media_id = ?', [req.params.id], (e) => res.json({ success: !e })));

// --- 4. LAYOUTS & REGIONS ---
app.post('/api/layouts', (req, res) => {
    const { name, orientation } = req.body;

    // 1. Lưu thông tin layout
    db.query('INSERT INTO layouts (name, orientation) VALUES (?, ?)', [name, orientation], (e, r) => {
        if (e) return res.json({ success: false });
        const layoutId = r.insertId;

        // 2. Tính toán kích thước dựa trên orientation
        // Nếu là 'portrait' (dọc) thì đảo ngược kích thước thành 1080x1920
        const width = orientation === 'portrait' ? 1080 : 1920;
        const height = orientation === 'portrait' ? 1920 : 1080;

        // 3. Tạo region "Fullscreen" mặc định với kích thước ĐÚNG
        db.query("INSERT INTO layout_regions (layout_id, name, top_pos, left_pos, width, height) VALUES (?, 'Fullscreen', 0, 0, ?, ?)",
            [layoutId, width, height],
            () => res.json({ id: layoutId })
        );
    });
});
app.get('/api/layouts', (req, res) => db.query('SELECT * FROM layouts ORDER BY id DESC', (e, r) => res.json(r)));
app.put('/api/layouts/:id', (req, res) => db.query('UPDATE layouts SET name = ?, orientation = ? WHERE id = ?', [req.body.name, req.body.orientation, req.params.id], (e) => res.json({ success: !e })));
app.delete('/api/layouts/:id', (req, res) => db.query('DELETE FROM layouts WHERE id = ?', [req.params.id], (e) => res.json({ success: !e })));

app.get('/api/layouts/:id/regions', (req, res) => db.query('SELECT * FROM layout_regions WHERE layout_id = ? ORDER BY z_index ASC, id ASC', [req.params.id], (e, r) => res.json(r)));
app.post('/api/regions', (req, res) => {
    const { layout_id, name, top, left, width, height, z_index } = req.body;
    db.query('INSERT INTO layout_regions (layout_id, name, top_pos, left_pos, width, height, z_index) VALUES (?,?,?,?,?,?,?)',
        [layout_id, name, top, left, width, height, z_index || 1], (e) => res.json({ success: !e }));
});
app.put('/api/regions/:id', (req, res) => {
    const { name, top, left, width, height, z_index } = req.body;
    db.query('UPDATE layout_regions SET name=?, top_pos=?, left_pos=?, width=?, height=?, z_index=? WHERE id=?',
        [name, top, left, width, height, z_index, req.params.id], (e) => res.json({ success: !e }));
});
app.delete('/api/regions/:id', (req, res) => db.query('DELETE FROM layout_regions WHERE id = ?', [req.params.id], (e) => res.json({ success: !e })));

app.get('/api/layouts/:id/items', (req, res) => {
    let sql = `SELECT li.id as item_id, li.media_order, li.media_id, li.region_id, m.* FROM layout_items li JOIN media m ON li.media_id = m.id WHERE li.layout_id = ?`;
    const params = [req.params.id];
    if (req.query.region_id) { sql += " AND li.region_id = ?"; params.push(req.query.region_id); }
    sql += " ORDER BY li.media_order ASC, li.id ASC";
    db.query(sql, params, (e, r) => res.json(r));
});

app.post('/api/layouts/:id/update-items', (req, res) => {
    const layoutId = req.params.id;
    const { items, region_id } = req.body;
    if (!region_id) return res.json({ success: false, error: "Thiếu Region ID" });

    db.query('DELETE FROM layout_items WHERE layout_id = ? AND region_id = ?', [layoutId, region_id], (err) => {
        if (err) return res.json({ success: false, error: err.message });
        if (!items || items.length === 0) return res.json({ success: true });
        const values = items.map((mediaId, index) => [layoutId, mediaId, index + 1, region_id]);
        db.query('INSERT INTO layout_items (layout_id, media_id, media_order, region_id) VALUES ?', [values], (e) => res.json({ success: !e }));
    });
});

// --- 5. CAMPAIGNS ---
app.get('/api/campaigns', (req, res) => {
    const sql = `SELECT c.*, (SELECT COUNT(*) FROM campaign_layouts cl WHERE cl.campaign_id = c.id) as count FROM campaigns c ORDER BY c.id DESC`;
    db.query(sql, (e, r) => res.json(r));
});
app.post('/api/campaigns', (req, res) => db.query('INSERT INTO campaigns (name) VALUES (?)', [req.body.name], (e, r) => res.json({ id: r.insertId })));
app.put('/api/campaigns/:id', (req, res) => db.query('UPDATE campaigns SET name = ? WHERE id = ?', [req.body.name, req.params.id], (e) => res.json({ success: !e })));
app.delete('/api/campaigns/:id', (req, res) => db.query('DELETE FROM campaigns WHERE id = ?', [req.params.id], (e) => res.json({ success: !e })));
app.get('/api/campaigns/:id/items', (req, res) => {
    const sql = `SELECT cl.id as item_id, cl.layout_order, cl.layout_id, l.name, l.orientation FROM campaign_layouts cl JOIN layouts l ON cl.layout_id = l.id WHERE cl.campaign_id = ? ORDER BY cl.layout_order ASC`;
    db.query(sql, [req.params.id], (e, r) => res.json(r));
});
app.post('/api/campaigns/:id/update-items', (req, res) => {
    const campaignId = req.params.id; const items = req.body.items;
    db.query('DELETE FROM campaign_layouts WHERE campaign_id = ?', [campaignId], (err) => {
        if (err) return res.json({ success: false, error: err.message });
        if (!items || !items.length) return res.json({ success: true });
        const values = items.map((layoutId, index) => [campaignId, layoutId, index + 1]);
        db.query('INSERT INTO campaign_layouts (campaign_id, layout_id, layout_order) VALUES ?', [values], (e) => res.json({ success: !e }));
    });
});

// --- 6. SCHEDULE (LOGIC MỚI: ONE-TO-MANY) ---

// Helper function để lấy targets cho schedule
const attachTargetsToSchedules = (schedules) => {
    return new Promise((resolve, reject) => {
        if (schedules.length === 0) return resolve([]);
        const ids = schedules.map(s => s.id);
        const sql = `
            SELECT st.*, 
                IF(st.target_type='device', d.name, g.name) as target_name 
            FROM schedule_targets st 
            LEFT JOIN devices d ON (st.target_type='device' AND st.target_id=d.id)
            LEFT JOIN display_groups g ON (st.target_type='group' AND st.target_id=g.id)
            WHERE st.schedule_id IN (?)
        `;
        db.query(sql, [ids], (err, targets) => {
            if (err) return resolve(schedules);
            schedules.forEach(s => {
                s.targets = targets.filter(t => t.schedule_id === s.id);
                // Tạo chuỗi tên hiển thị (vd: "📺 TV1, 👥 Group A")
                s.target_names = s.targets.map(t =>
                    (t.target_type === 'device' ? '📺 ' : '👥 ') + (t.target_name || 'Unknown')
                ).join(', ');
            });
            resolve(schedules);
        });
    });
};

app.get('/api/schedules', (req, res) => {
    const sql = `SELECT s.*, l.name as layout_name, c.name as campaign_name 
                 FROM schedules s 
                 LEFT JOIN layouts l ON s.layout_id = l.id 
                 LEFT JOIN campaigns c ON s.campaign_id = c.id 
                 ORDER BY s.priority DESC, s.start_time DESC`;
    db.query(sql, async (err, rows) => {
        if (err) return res.json([]);
        const result = await attachTargetsToSchedules(rows);
        res.json(result);
    });
});

app.post('/api/schedule', (req, res) => {
    const { targets, content_type, content_id, start_time, end_time, priority } = req.body;
    
    // Xử lý định dạng ngày (MySQL không thích chữ 'T' từ input datetime-local)
    const start = start_time ? start_time.replace('T', ' ') : null;
    const end = end_time ? end_time.replace('T', ' ') : null;

    if (!start || !end) return res.status(400).json({ success: false, error: "Thiếu thời gian" });

    const layoutId = content_type === 'layout' ? content_id : null;
    const campId = content_type === 'campaign' ? content_id : null;

    db.query('INSERT INTO schedules (layout_id, campaign_id, start_time, end_time, priority) VALUES (?, ?, ?, ?, ?)',
        [layoutId, campId, start, end, priority || 0], (err, result) => {
            if (err) {
                console.error("Lỗi INSERT schedule:", err);
                return res.json({ success: false, error: err.message });
            }

            const scheduleId = result.insertId;
            if (!targets || !targets.length) return res.json({ success: true });

            const values = targets.map(t => [scheduleId, t.type, t.id]);
            db.query('INSERT INTO schedule_targets (schedule_id, target_type, target_id) VALUES ?', [values], (e) => {
                if (e) console.error("Lỗi INSERT schedule_targets:", e);
                res.json({ success: !e, error: e ? e.message : null });
            });
        });
});

app.put('/api/schedules/:id', (req, res) => {
    const { targets, content_type, content_id, start_time, end_time, priority } = req.body;
    const id = req.params.id;
    const layoutId = content_type === 'layout' ? content_id : null;
    const campId = content_type === 'campaign' ? content_id : null;

    db.query('UPDATE schedules SET layout_id=?, campaign_id=?, start_time=?, end_time=?, priority=? WHERE id=?',
        [layoutId, campId, start_time, end_time, priority || 0, id], (err) => {
            if (err) return res.json({ success: false });

            // Xóa targets cũ và insert mới
            db.query('DELETE FROM schedule_targets WHERE schedule_id = ?', [id], () => {
                if (!targets || !targets.length) return res.json({ success: true });
                const values = targets.map(t => [id, t.type, t.id]);
                db.query('INSERT INTO schedule_targets (schedule_id, target_type, target_id) VALUES ?', [values], (e) => res.json({ success: !e }));
            });
        });
});

app.delete('/api/schedule/:id', (req, res) => db.query('DELETE FROM schedules WHERE id = ?', [req.params.id], (e) => res.json({ success: !e })));

// --- 7. PLAYER API (XỬ LÝ PREVIEW) ---
// --- 7. PLAYER API (XỬ LÝ PREVIEW & SCHEDULE ĐA MỤC TIÊU) ---
app.get('/api/play/:deviceCode', (req, res) => {
    const code = req.params.deviceCode;
    const reportedHash = req.query.hash || '';
    const isDownloading = req.query.downloading === 'true' ? 1 : 0;
    const previewLayoutId = req.query.previewLayout;

    // Lấy IP Client
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    if (clientIp.includes('::ffff:')) clientIp = clientIp.split('::ffff:')[1];

    // 1. Kiểm tra thiết bị tồn tại chưa
    db.query('SELECT id, name, orientation, status, default_layout_id, pending_command FROM devices WHERE device_code = ?', [code], (err, devices) => {
        let device = devices && devices.length ? devices[0] : null;

        // Logic Preview nhanh cho PREVIEW_BOX (Bỏ qua duyệt)
        if (code === 'PREVIEW_BOX' && !device) {
            device = { id: 0, name: 'DEMO PREVIEW', orientation: 'landscape', status: 1 };
        }

        if (code === 'PREVIEW_BOX' && previewLayoutId) {
            return processLayout(previewLayoutId, device, null);
        }

        if (err || !device) {
            // Nếu là thiết bị mới (không phải Box Preview) -> Tự động tạo
            if (!device && code !== 'PREVIEW_BOX') {
                db.query('INSERT INTO devices (name, device_code, orientation, status) VALUES (?, ?, ?, 0)', ["NEW-" + code.substring(0, 6), code, 'landscape']);
            }
            return res.json({ hash: "pending", status: 0 });
        }

        const pendingCmd = device.pending_command;

        // Update trạng thái thiết bị (Heartbeat)
        if (code !== 'PREVIEW_BOX') {
            if (pendingCmd) db.query('UPDATE devices SET pending_command = NULL WHERE id = ?', [device.id]);
            db.query('UPDATE devices SET last_seen = NOW(), ip_address = ?, reported_hash = ?, active_hash = ?, is_downloading = ? WHERE id = ?',
                [clientIp, reportedHash, null, isDownloading, device.id]);
        }

        // Với PREVIEW_BOX, bỏ qua check status
        if (device.status === 0 && code !== 'PREVIEW_BOX') return res.json({ hash: "pending", status: 0 });

        // 2. Tìm Lịch Trình (Logic Mới: Join bảng schedule_targets)
        const sqlSchedule = `
            SELECT s.id, s.layout_id, s.campaign_id, s.start_time, s.end_time, l.orientation as layout_orientation
            FROM schedules s 
            LEFT JOIN layouts l ON s.layout_id = l.id
            JOIN schedule_targets st ON s.id = st.schedule_id
            WHERE 
            (
                (st.target_type = 'device' AND st.target_id = ?) 
                OR 
                (st.target_type = 'group' AND st.target_id IN (SELECT group_id FROM group_members WHERE device_id = ?))
            )
            AND NOW() BETWEEN s.start_time AND s.end_time
            ORDER BY s.priority DESC, s.start_time DESC LIMIT 1
        `;

        db.query(sqlSchedule, [device.id, device.id], (err, schedules) => {
            if (schedules.length) {
                const s = schedules[0]; // <--- QUAN TRỌNG: Dòng này định nghĩa biến 's'

                if (s.campaign_id) {
                    // --- LOGIC MỚI: TÍNH THỜI GIAN THỰC CỦA CAMPAIGN ---

                    // 1. Lấy danh sách Layouts trong Campaign
                    db.query('SELECT layout_id FROM campaign_layouts WHERE campaign_id = ? ORDER BY layout_order ASC', [s.campaign_id], async (e, r) => {
                        if (!r || r.length === 0) return processLayout(null, device, pendingCmd);

                        try {
                            // 2. Tính thời lượng (Duration) cho TỪNG Layout
                            const timeline = [];
                            let totalCampaignDuration = 0;

                            for (const layout of r) {
                                // Query lấy tổng thời gian của vùng (Region) có nội dung dài nhất trong Layout này
                                const [rows] = await db.promise().query(`
                                    SELECT li.region_id, SUM(m.duration) as region_duration
                                    FROM layout_items li
                                    JOIN media m ON li.media_id = m.id
                                    WHERE li.layout_id = ?
                                    GROUP BY li.region_id
                                `, [layout.layout_id]);

                                let maxDuration = 10; // Mặc định 10s nếu layout trống
                                if (rows.length > 0) {
                                    maxDuration = Math.max(...rows.map(row => Number(row.region_duration)));
                                }

                                timeline.push({
                                    layout_id: layout.layout_id,
                                    start: totalCampaignDuration,
                                    duration: maxDuration
                                });
                                totalCampaignDuration += maxDuration;
                            }

                            // 3. Xác định Layout cần phát dựa trên thời gian hiện tại
                            if (totalCampaignDuration === 0) totalCampaignDuration = 10;

                            const currentCycleTime = (Date.now() / 1000) % totalCampaignDuration;

                            const currentLayout = timeline.find(l =>
                                currentCycleTime >= l.start && currentCycleTime < (l.start + l.duration)
                            );

                            const targetLayoutId = currentLayout ? currentLayout.layout_id : r[0].layout_id;
                            processLayout(targetLayoutId, device, pendingCmd);

                        } catch (err) {
                            console.error("Lỗi tính toán Campaign:", err);
                            processLayout(r[0].layout_id, device, pendingCmd);
                        }
                    });

                } else {
                    // Xử lý Layout đơn lẻ
                    processLayout(s.layout_id, device, pendingCmd);
                }
            } else {
                // Không có lịch -> Chạy layout mặc định
                processLayout(device.default_layout_id, device, pendingCmd);
            }
        });

        // Hàm xử lý layout và trả về JSON
        function processLayout(layoutId, device, cmd) {
            if (!layoutId) return sendResponse({ layout_id: null, settings: {}, regions: [] }, device.id, cmd);

            db.query('SELECT orientation FROM layouts WHERE id = ?', [layoutId], (e, lRows) => {
                const layoutOrient = lRows.length ? lRows[0].orientation : 'landscape';

                db.query('SELECT * FROM layout_regions WHERE layout_id = ? ORDER BY z_index ASC', [layoutId], (e, regions) => {
                    // Fallback: Nếu layout không có region, tạo region ảo Fullscreen
                    if (!regions.length) regions.push({ id: 'temp', name: 'Main', left_pos: 0, top_pos: 0, width: 1920, height: 1080, z_index: 1 });

                    db.query('SELECT li.*, m.type, m.path, m.duration, m.name, m.scale FROM layout_items li JOIN media m ON li.media_id = m.id WHERE li.layout_id = ? ORDER BY li.region_id, li.media_order', [layoutId], (e, items) => {
                        const regionsWithData = regions.map(reg => ({
                            id: reg.id, name: reg.name,
                            x: reg.left_pos, y: reg.top_pos, width: reg.width, height: reg.height, zIndex: reg.z_index,
                            // Lọc items thuộc region này
                            playlist: items.filter(i => i.region_id === reg.id || (reg.id === 'temp')).map(i => ({
                                id: i.media_id, type: i.type, path: i.path, duration: i.duration, name: i.name, scale: i.scale
                            }))
                        }));

                        // Settings: gửi cả hướng layout (nội dung) và hướng thiết bị (phần cứng)
                        const settings = {
                            layoutOrientation: layoutOrient,
                            deviceOrientation: device.orientation
                        };

                        sendResponse({
                            layout_id: layoutId,
                            settings: settings,
                            regions: regionsWithData
                        }, device.id, cmd);
                    });
                });
            });
        }

        // Hàm gửi phản hồi cuối cùng
        function sendResponse(p, devId, cmd) {
            // Tạo hash MD5 để so sánh thay đổi
            const activeHash = crypto.createHash('md5').update(JSON.stringify(p)).digest('hex');

            if (code !== 'PREVIEW_BOX') {
                db.query('UPDATE devices SET active_hash = ? WHERE id = ?', [activeHash, devId]);
            }

            res.json({
                hash: activeHash,
                settings: p.settings,
                regions: p.regions,
                command: cmd || null,
                device_id: devId,
                device_name: device.name // <-- QUAN TRỌNG: Gửi tên thiết bị xuống App
            });
        }
    });
});

const initDb = require('./initDb');

initDb().then(() => {
    app.listen(3000, () => console.log('CMS V3 Running on port 3000...'));
}).catch(err => {
    console.error('Failed to initialize database, shutting down:', err);
    process.exit(1);
});