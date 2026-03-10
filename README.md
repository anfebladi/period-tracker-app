# Rhythm – Backend

Frontend Repository: https://github.com/anfebladi/period-tracker-app-client

Backend service for **Rhythm**, a privacy-first menstrual health tracking application.  
This API handles cycle data management, predictions, PDF report generation, authentication, and AI-powered health insights.

---

## Tech Stack

- **Node.js**
- **Express.js**
- **PostgreSQL**
- **Neon** (serverless Postgres)
- **Gemini LLM API** (AI health assistant)

---

## Features

### 🔐 Privacy-First Authentication
- Temporary randomized token-based authentication
- No personally identifiable information required
- User data remains unlinked to real-world identities

### 📊 Cycle Tracking & Predictions
- Store and manage menstrual cycle logs and symptoms
- Predict future cycle lengths using a mathematical prediction model
- Analyze historical trends

### 📄 PDF Report Generation
- Generate professional PDF summaries of cycle history
- Designed for sharing with OB/GYNs and healthcare providers

### 🤖 AI Health Assistant
- Integrates Gemini LLM with tailored prompts
- Provides contextual menstrual health insights
- Answers common health-related questions

