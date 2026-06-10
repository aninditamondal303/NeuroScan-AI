# 🧠 NeuroScan AI – AI-Powered Brain MRI Analysis Platform

NeuroScan AI is an intelligent medical imaging application designed to assist in the analysis of brain MRI scans using Generative AI. The platform provides AI-generated diagnostic insights, interactive visualization, and structured medical observations to support healthcare research and educational use cases.

Developed as a full-stack application, NeuroScan AI combines a modern React-based frontend with a TypeScript backend and integrates Google's Gemini AI model for intelligent image interpretation and report generation.

---

## 🚀 Key Features

* MRI scan upload and analysis workflow
* AI-powered medical image interpretation
* Automated diagnostic report generation
* Interactive and responsive user interface
* Real-time AI inference using Gemini API
* Secure environment-based API key management
* Sample MRI datasets for demonstration and testing

---

## 🏗️ System Architecture

```text
                ┌───────────────────────┐
                │      React Frontend   │
                │   Vite + TypeScript   │
                └───────────┬───────────┘
                            │
                            │ MRI Image Upload
                            ▼
                ┌───────────────────────┐
                │    Node.js Backend    │
                │      TypeScript       │
                └───────────┬───────────┘
                            │
                            │ API Request
                            ▼
                ┌───────────────────────┐
                │   Google Gemini API   │
                │   Image Understanding │
                └───────────┬───────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ Diagnostic Insights & │
                │ Structured AI Report  │
                └───────────────────────┘
```

---

## 🛠️ Technology Stack

### Frontend

* React.js
* TypeScript
* Vite
* HTML5
* CSS3

### Backend

* Node.js
* TypeScript
* Express.js

### Artificial Intelligence

* Google Gemini API
* Generative AI
* Prompt Engineering

### Development Tools

* Git
* GitHub
* VS Code
* npm

---

## 📂 Project Structure

```text
NeuroScan-AI/
│
├── assets/
├── backend/
├── notebooks/
├── src/
│
├── server.ts
├── package.json
├── tsconfig.json
├── vite.config.ts
├── docker-compose.yml
├── README.md
└── .env
```

---

## ⚙️ Installation & Setup

### Clone the Repository

```bash
git clone https://github.com/aninditamondal303/NeuroScan-AI.git
cd NeuroScan-AI
```

### Install Dependencies

```bash
npm install
```

### Configure Environment Variables

Create a `.env` file in the project root directory:

```env
GEMINI_API_KEY=YOUR_API_KEY
APP_URL=http://localhost:3000
```

### Run the Application

```bash
npm run dev
```

The application will be available at:

```text
http://localhost:3000
```

---

## 🎯 Workflow

1. Upload a brain MRI scan.
2. The image is processed by the application.
3. Gemini AI analyzes the uploaded scan.
4. The system generates medical observations and diagnostic insights.
5. Results are presented through an intuitive dashboard interface.

---

## 💡 Potential Applications

* Medical imaging research
* AI-assisted healthcare education
* Diagnostic support systems
* Computer vision experimentation
* Generative AI healthcare applications

---

## 🔒 Security

* API keys are stored using environment variables.
* Sensitive credentials are excluded from version control through `.gitignore`.
* Secure client-server communication architecture.

---

## 📈 Future Enhancements

* Integration with trained deep learning models
* Advanced MRI image preprocessing
* Multi-modal medical report generation
* User authentication and role management
* Cloud deployment and scalability improvements
* Medical dataset benchmarking and analytics

---

## 👨‍💻 Author

Anindita Mondal
B.Tech – Computer Science Engineering (Artificial Intelligence & Machine Learning)
SRM Institute of Science and Technology

GitHub: https://github.com/aninditamondal303

---

## ⭐ Project Highlights

* Full-Stack AI Application
* Medical Imaging Domain
* Gemini API Integration
* TypeScript-Based Development
* Real-Time AI Analysis Workflow
* Portfolio & Placement Ready Project
