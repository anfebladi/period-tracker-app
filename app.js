
const PORT = 3000;
import { pool } from "./db.js"
import express from 'express'
import dotenv from 'dotenv'
import { GoogleGenerativeAI } from '@google/generative-ai'

dotenv.config()

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const app = express()
app.use(express.json())

// Optional: get cycle context for the health assistant (profile id, default 3)
async function getCycleContext(profileId = 3) {
  try {
    const { rows } = await pool.query(
      'SELECT lastperiod, avgcyclelength FROM profiles WHERE id = $1',
      [profileId]
    );
    if (!rows[0]) return null;
    const { lastperiod, avgcyclelength } = rows[0];
    const today = new Date();
    const lastPeriod = new Date(lastperiod);
    const daysPast = Math.floor((today - lastPeriod) / (1000 * 60 * 60 * 24));
    const currentDay = (daysPast % avgcyclelength) + 1;
    const ovulationDay = avgcyclelength < 21
      ? Math.floor(avgcyclelength / 2)
      : avgcyclelength - 14;
    let phase = 'Unknown';
    if (currentDay <= 5) phase = 'Menses';
    else if (currentDay < ovulationDay - 2) phase = 'Follicular';
    else if (currentDay >= ovulationDay - 2 && currentDay <= ovulationDay + 1) phase = 'Ovulation';
    else phase = 'Luteal';
    return { currentDay, phase, avgcyclelength };
  } catch {
    return null;
  }
}


// first time logging in
import { v4 as uuidv4 } from 'uuid';
app.post("/api/newuser", async (req, res) => {
    try {
        const { avgcyclelength} = req.body;
        const anonymousId = uuidv4(); 
        const insertUserQuery = `
            INSERT INTO profiles (id, avgcyclelength) 
            VALUES ($1, $2)
        `;
        await pool.query(insertUserQuery, [anonymousId, avgcyclelength]);
        
        res.json({ 
            message: "Profile created!", 
            userToken: anonymousId 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not create profile" });
    }
});


const checkAuth = (req, res, next) => {
    const token = req.headers['x-user-token'];
    if (!token) {
        return res.status(401).json({ error: "No ID found. Please complete onboarding." });
    }
    req.userId = token; 
    next();
};


app.get("/api", (req,res)=> {
    res.send('we working gang')
})


// get your status + current date
// im having a lot of issues with the timezone migth need to use a library for this or sum
app.get('/api/period', checkAuth, async (req, res) => {
    try {
        const getPeriodQuery = `
            SELECT p.avgcyclelength, pd.startdate 
            FROM profiles p 
            JOIN period pd ON p.id = pd.userid 
            WHERE p.id = $1 AND pd.enddate IS NULL
            ORDER BY pd.startdate DESC LIMIT 1
        `;
        
        const raw = await pool.query(getPeriodQuery, [req.userId]);
        
        if (raw.rows.length === 0) {
            return res.status(404).json({ error: "No active cycle found (enddate is not null)." });
        }

        const results = raw.rows[0];
        const cycleLength = parseInt(results.avgcyclelength) || 28;

        const now = new Date();
        const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

        const startDateObj = new Date(results.startdate);
        const startUTC = Date.UTC(startDateObj.getUTCFullYear(), startDateObj.getUTCMonth(), startDateObj.getUTCDate());

        const diffInMs = todayUTC - startUTC;
        const daysPast = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

      
        const currentDay = ((daysPast % cycleLength) + cycleLength) % cycleLength + 1;

        let phase;
        const ovulationDay = cycleLength - 14; 

        if (currentDay <= 5) { 
            phase = "Menses";
        } else if (currentDay < ovulationDay - 2) {
            phase = "Follicular";
        } else if (currentDay >= ovulationDay - 2 && currentDay <= ovulationDay + 1) {
            phase = "Ovulation";
        } else {
            phase = "Luteal";
        }

        res.json({ 
            day_in_cycle: currentDay, 
            phase: phase 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database or Calculation Error" });
    }
});

//symptom logger

app.post("/api/logger", checkAuth, async (req, res) => {
    try {
        const { symptomname, severity } = req.body;

        if (!symptomname || !severity) {
            return res.status(400).json({ error: "please enter both symptom name and severity" });
        }

        const logSymptomQuery = "INSERT INTO symptomdecoder (userid, symptomname, severity) VALUES ($1, $2, $3) RETURNING *";
        
        await pool.query(logSymptomQuery, [req.userId, symptomname, severity]);

        res.json("everything was logged sucesfully");
    } catch (err) {
        console.error(err); 
        res.status(500).json({ error: "an error has ocurred", detail: err.message });
    }
});

//next 6 periods predictor
// call this endpoint for calendar
app.get('/api/predictions', checkAuth, async (req, res) => {
    try {
        const queryToGetInfo = `
            SELECT p.avgcyclelength, pd.startdate 
            FROM profiles p 
            JOIN period pd ON p.id = pd.userid 
            WHERE p.id = $1 AND pd.enddate IS NULL 
            ORDER BY pd.startdate DESC LIMIT 1;
        `;
        
        const results = await pool.query(queryToGetInfo, [req.userId]);

        if (results.rows.length === 0) {
            return res.status(404).json({ error: "No active period found to base predictions on." });
        }

        const { startdate, avgcyclelength } = results.rows[0];
        let predictions = [];
        let currentRefDate = new Date(startdate);

        for (let i = 0; i < 6; i++) {
            currentRefDate.setDate(currentRefDate.getDate() + avgcyclelength);
            let endDate = new Date(currentRefDate);
            endDate.setDate(endDate.getDate() + 5);

            predictions.push({
                period_number: i + 1,
                estimated_start: currentRefDate.toISOString().split('T')[0],
                estimated_end: endDate.toISOString().split('T')[0]
            });
        }

        res.json(predictions);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Prediction failed", detail: err.message });
    }
});







// first period ever 
app.post("/api/first-period", checkAuth, async (req, res) => {
    try {
        const { startDate } = req.body; 

    
        if (!startDate) {
            return res.status(400).json({ error: "startDate is required" });
        }

        const insertPeriodQuery = `
            INSERT INTO period (userid, startdate, enddate) 
            VALUES ($1, $2, NULL) 
            RETURNING *
        `;
        
        const result = await pool.query(insertPeriodQuery, [req.userId, startDate]);

        res.json({
            message: "First period logged successfully",
            period: result.rows[0]
        });

    } catch (err) {
        console.error("Error logging first period:", err.stack);
        res.status(500).json({ error: "An error occurred", detail: err.message });
    }
});



//update new period
//needs further testing
app.post("/api/new-period", checkAuth, async (req, res) => {
    const client = await pool.connect(); 
    try {
        const { startDate } = req.body; 
        const todayStr = startDate;

        await client.query('BEGIN'); 

        const closeQuery = `
            UPDATE period
            SET enddate = $1 
            WHERE userid = $2 AND enddate IS NULL
        `;
        const yesterday = new Date(todayStr);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        await client.query(closeQuery, [yesterdayStr, req.userId]);

        const openQuery = `
            INSERT INTO period (userid, startdate, enddate) 
            VALUES ($1, $2, NULL) 
            RETURNING *;
        `;
        await client.query(openQuery, [req.userId, todayStr]);

        const historyQuery = `
            SELECT startdate FROM period 
            WHERE userid = $1 
            ORDER BY startdate DESC LIMIT 3
        `;
        const history = await client.query(historyQuery, [req.userId]);

        if (history.rows.length >= 2) {
            let totalDays = 0;
            let count = 0;

            for (let i = 0; i < history.rows.length - 1; i++) {
                const d1 = new Date(history.rows[i].startdate);
                const d2 = new Date(history.rows[i + 1].startdate);
                
             
                const diff = Math.round((d1 - d2) / (1000 * 60 * 60 * 24));
                totalDays += diff;
                count++;
            }

            const newAvg = Math.round(totalDays / count);

            await client.query(
                'UPDATE profiles SET avgcyclelength = $1 WHERE id = $2',
                [newAvg, req.userId]
            );
        }

        await client.query('COMMIT'); 

        res.json({
            message: "Cycle updated and average recalculated.",
            newAverage: history.rows.length >= 2 ? "Updated" : "Not enough data yet"
        });

    } catch (err) {
        await client.query('ROLLBACK'); 
        console.error("Transaction Error:", err);
        res.status(500).json({ error: "Failed to update cycle", detail: err.message });
    } finally {
        client.release(); 
    }
});
// Gemini health assistant 
app.post('/api/assistant', async (req, res) => {
    try {
        if (!genAI) {
            return res.status(503).json({
                error: 'Health assistant is not configured. Set GEMINI_API_KEY in .env.',
            });
        }
        const { message, profileId = 3 } = req.body;
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Please provide a non-empty "message" in the request body.' });
        }
        const cycleContext = await getCycleContext(profileId);
        const contextStr = cycleContext
            ? `The user is on day ${cycleContext.currentDay} of their cycle (phase: ${cycleContext.phase}, average cycle length: ${cycleContext.avgcyclelength} days).`
            : 'No cycle data is available for this user.';
        const systemInstruction = `You are a supportive, respectful health assistant for a period/cycle tracking app. You can discuss cycles, symptoms, wellness, and general health tips. Always remind users you are not a doctor and they should see a healthcare provider for medical advice. Be concise and helpful. Current user context: ${contextStr}`;
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            systemInstruction,
        });
        const result = await model.generateContent(message.trim());
        const response = result.response;
        const text = response.text();
        if (!text) {
            return res.status(502).json({ error: 'Assistant did not return a reply.' });
        }
        res.json({ reply: text });
    } catch (err) {
        console.error('Assistant error:', err);
        res.status(500).json({
            error: 'The health assistant could not process your message.',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined,
        });
    }
});


// past 10 logs
app.get("/api/logs", checkAuth, async (req, res) => {
    try {
        const query = "SELECT * FROM symptomdecoder WHERE userid = $1 ORDER BY id DESC LIMIT 10";
        const results = await pool.query(query, [req.userId]);
        
        res.json(results.rows);
    } catch (err) {
        res.status(500).json({ error: "Could not fetch logs" });
    }
});


//get pdf
import PDFDocument from 'pdfkit';

app.get("/api/logs/pdf", checkAuth, async (req, res) => {
    try {
        const query = `
            SELECT 
                s.symptomname, 
                s.severity, 
                s.logged_at,
                (SELECT startdate FROM period 
                 WHERE userid = $1 AND startdate <= s.logged_at 
                 ORDER BY startdate DESC LIMIT 1) as period_start,
                (SELECT enddate FROM period 
                 WHERE userid = $1 AND startdate <= s.logged_at 
                 ORDER BY startdate DESC LIMIT 1) as period_end
            FROM SYMPTOMDECODER s
            WHERE s.userid = $1 
            ORDER BY s.logged_at DESC 
            LIMIT 10
        `;
        
        const results = await pool.query(query, [req.userId]);

        if (results.rows.length === 0) {
            return res.status(404).send("No symptom logs found.");
        }

        const doc = new PDFDocument();
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=symptom_report.pdf');

        doc.pipe(res); 

        doc.fontSize(20).text('Symptom Log Report', { align: 'center' });
        doc.moveDown();

        results.rows.forEach(log => {
            const logDate = new Date(log.logged_at).toLocaleDateString();
            const pStart = log.period_start ? new Date(log.period_start).toLocaleDateString() : "N/A";
            const pEnd = log.period_end ? new Date(log.period_end).toLocaleDateString() : "Present";

            doc.fontSize(12).text(`Date Logged: ${logDate}`);
            doc.fontSize(14).text(`Symptom: ${log.symptomname} | Severity: ${log.severity}/5`);
            doc.fontSize(10).fillColor('gray').text(`Associated Period: ${pStart} to ${pEnd}`);
            doc.fillColor('black').text(`---------------------------------------`);
            doc.moveDown(0.5);
        });

        doc.end();
    } catch (err) {
        console.error("PDF Generation Error:", err);
        res.status(500).send("An error occurred while generating the PDF.");
    }
}); 









app.listen(PORT , (req,res)=> {
    console.log('running')
})