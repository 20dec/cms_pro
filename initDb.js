const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function initDb() {
    console.log('--- Database & Folder Initialization ---');

    // 1. Create necessary folders
    const folders = [
        path.join(__dirname, 'public'),
        path.join(__dirname, 'public/uploads'),
        path.join(__dirname, 'public/screenshots')
    ];

    folders.forEach(folder => {
        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true });
            console.log(`[Folder] Created: ${folder}`);
        }
    });

    // 2. Connect to MySQL and Initialize Schema
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
        });

        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``);
        await connection.query(`USE \`${process.env.DB_NAME}\``);

        const tables = {
            devices: `
                CREATE TABLE IF NOT EXISTS devices (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255),
                    device_code VARCHAR(100) UNIQUE,
                    orientation VARCHAR(50) DEFAULT 'landscape',
                    default_layout_id INT NULL,
                    status INT DEFAULT 0,
                    pending_command TEXT NULL,
                    last_seen DATETIME NULL,
                    last_screenshot_path VARCHAR(255) NULL,
                    ip_address VARCHAR(50) NULL,
                    reported_hash VARCHAR(255) NULL,
                    active_hash VARCHAR(255) NULL,
                    is_downloading TINYINT DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,
            display_groups: `
                CREATE TABLE IF NOT EXISTS display_groups (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,
            group_members: `
                CREATE TABLE IF NOT EXISTS group_members (
                    group_id INT NOT NULL,
                    device_id INT NOT NULL,
                    PRIMARY KEY (group_id, device_id)
                )`,
            media: `
                CREATE TABLE IF NOT EXISTS media (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    type VARCHAR(50) NOT NULL,
                    path TEXT NOT NULL,
                    duration INT DEFAULT 10,
                    scale INT DEFAULT 100,
                    size BIGINT DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,
            layouts: `
                CREATE TABLE IF NOT EXISTS layouts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    orientation VARCHAR(50) DEFAULT 'landscape',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,
            layout_regions: `
                CREATE TABLE IF NOT EXISTS layout_regions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    layout_id INT NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    top_pos INT DEFAULT 0,
                    left_pos INT DEFAULT 0,
                    width INT DEFAULT 1920,
                    height INT DEFAULT 1080,
                    z_index INT DEFAULT 1
                )`,
            layout_items: `
                CREATE TABLE IF NOT EXISTS layout_items (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    layout_id INT NOT NULL,
                    media_id INT NOT NULL,
                    media_order INT DEFAULT 0,
                    region_id INT NOT NULL
                )`,
            campaigns: `
                CREATE TABLE IF NOT EXISTS campaigns (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,
            campaign_layouts: `
                CREATE TABLE IF NOT EXISTS campaign_layouts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    campaign_id INT NOT NULL,
                    layout_id INT NOT NULL,
                    layout_order INT DEFAULT 0
                )`,
            schedules: `
                CREATE TABLE IF NOT EXISTS schedules (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    layout_id INT NULL,
                    campaign_id INT NULL,
                    start_time DATETIME NOT NULL,
                    end_time DATETIME NOT NULL,
                    priority INT DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,
            schedule_targets: `
                CREATE TABLE IF NOT EXISTS schedule_targets (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    schedule_id INT NOT NULL,
                    target_type VARCHAR(50) NOT NULL,
                    target_id INT NOT NULL
                )`
        };

        for (const [tableName, sql] of Object.entries(tables)) {
            await connection.query(sql);
            console.log(`[DB] Table checked/created: ${tableName}`);
        }

        await connection.end();
        console.log('--- Initialization Completed ---');
    } catch (error) {
        console.error('[Error] DB Initialization failed:', error.message);
        throw error;
    }
}

if (require.main === module) {
    initDb();
}

module.exports = initDb;
