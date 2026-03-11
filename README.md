# CMS Pro V3 - Digital Signage System

CMS Pro V3 is a powerful and versatile Digital Signage Content Management System. It allows you to manage multiple displays, organize them into groups, and schedule rich media content including images, videos, and websites with multi-region support.

![CMS Admin Interface](https://via.placeholder.com/1200x600/0d6efd/ffffff?text=CMS+Pro+V3+Admin+Panel)

## 🚀 Features

- **Device Management**: Real-time monitoring of display status (Online/Offline), IP tracking, and remote screenshot capabilities.
- **Multi-Region Layouts**: Create complex layouts with multiple overlapping or tiled regions.
- **Dynamic Playlists**: Each region can have its own sequence of media with customizable durations.
- **Campaigns**: Sequence multiple layouts to create complex content loops.
- **Advanced Scheduling**: Schedule content for specific devices or groups based on date and time, with a priority-based override system.
- **Media Support**:
  - 🖼️ Images (JPG, PNG, GIF, WebP)
  - 🎥 Videos (MP4)
  - 🌐 Websites/Dashboards (URL embedding with scaling)
- **Automatic Sync**: Devices automatically check for updates and synchronize content.
- **Orientation Support**: Full support for both Landscape and Portrait displays and layouts.

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js
- **Database**: MySQL (using `mysql2` with connection pooling)
- **File Management**: Multer (for media and screenshot uploads)
- **Frontend**: HTML5, CSS3 (Bootstrap 5), Vanilla JavaScript
- **API**: RESTful JSON API

## 📁 Project Structure

```text
cms-pro/
├── public/             # Static assets and frontend
│   ├── uploads/        # Uploaded media files
│   ├── screenshots/    # Device screenshots
│   ├── admin.html      # Main management dashboard
│   └── player.html     # Display player application
├── initDb.js           # Database initialization script
├── server.js           # Main Express server and API
├── package.json        # Dependencies and scripts
└── .env                # Environment configuration
```

## 🏁 Getting Started

### 1. Prerequisites
- Node.js (v14 or higher)
- MySQL Server

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd cms-pro
npm install
```

### 3. Configuration
Create a `.env` file in the root directory and configure your database settings:
```ini
DB_HOST=localhost
DB_USER=root
DB_PASS=your_password
DB_NAME=pro_cms
```

### 4. Database Setup
Initialize the database schema:
```bash
npm run init-db
```

### 5. Running the Application
Start the server:
```bash
npm start
```
The system will be available at `http://localhost:3000`.

## 🖥️ Usage

1.  **Admin Panel**: Access `http://localhost:3000/admin.html` to manage your signage network.
2.  **Display Player**: Open `http://localhost:3000/player.html?code=DEVICE_CODE` on any screen to start playback. Replace `DEVICE_CODE` with a unique identifier for that screen.
3.  **Approval**: New displays appearing in the Admin Panel must be "Approved" before they can receive content.

## 📡 API Overview

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/displays` | GET/PUT/DELETE | Manage display devices |
| `/api/media` | GET/POST/DELETE | Manage media assets |
| `/api/layouts` | GET/POST/PUT/DELETE | Manage multi-region layouts |
| `/api/campaigns` | GET/POST/PUT/DELETE | Manage layout sequences |
| `/api/schedules` | GET/POST/DELETE | Manage content scheduling |
| `/api/play/:code` | GET | Endpoint for players to fetch instructions |

---
*Created with ❤️ for professional digital signage.*
