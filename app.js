

const PORT = 5000;
import { pool } from "./db.js"
import express from 'express'
import dotenv from 'dotenv'
import { GoogleGenerativeAI } from '@google/generative-ai'

dotenv.config()




const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const assistantModel = genAI.getGenerativeModel(
    { model: "gemini-2.5-flash" }, 
);

const safetyAuditorModel = genAI.getGenerativeModel(
    { model: "gemini-2.5-flash" },

)


const app = express()
app.use(express.json())

import { DateTime } from 'luxon';

function toDateTime(val) {
    if (!val) return null;
    if (val instanceof Date) return DateTime.fromJSDate(val);
    if (typeof val === 'string') return DateTime.fromISO(val);
    return DateTime.fromJSDate(val);
}

function getCycleStatusFromDays(daysPast, cycleLength) {
    const ovulationDay = cycleLength - 14;
   
    if (cycleLength === 30 && daysPast >= 30) {
        return {
            currentDay: daysPast + 1,
            phase: 'Next period soon'
        };
    }

    if (daysPast >= cycleLength) {
       
        return {
            currentDay: ((daysPast % cycleLength) + cycleLength) % cycleLength + 1,
            phase: 'Next period soon'
        };
    }

    const currentDay = ((daysPast % cycleLength) + cycleLength) % cycleLength + 1;

    let phase;
    if (currentDay <= 5) {
        phase = 'Menses';
    } else if (currentDay < ovulationDay - 2) {
        phase = 'Follicular';
    } else if (currentDay >= ovulationDay - 2 && currentDay <= ovulationDay + 1) {
        phase = 'Ovulation';
    } else {
        phase = 'Luteal';
    }

    return { currentDay, phase };
}

async function getCycleContext(profileId) {
  try {
    const query = `
      SELECT p.avgcyclelength, pd.startdate 
      FROM profiles p 
      JOIN period pd ON p.id = pd.userid 
      WHERE p.id = $1 
      ORDER BY pd.startdate DESC LIMIT 1
    `;
    const { rows } = await pool.query(query, [profileId]);
    
    if (!rows[0] || !rows[0].startdate) return null;

    const { startdate, avgcyclelength } = rows[0];
    const cycleLength = parseInt(avgcyclelength) || 28;
    
    
    const today = DateTime.now().startOf('day');
    const startDate = toDateTime(startdate).startOf('day');
    
    
    const daysPast = Math.floor(today.diff(startDate, 'days').days);
    const cycleStatus = getCycleStatusFromDays(daysPast, cycleLength);
    const { currentDay, phase } = cycleStatus;

    return { currentDay, phase, avgcyclelength: cycleLength };
  } catch (err) {
    console.error("Context Error:", err);
    return null;
  }
}


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
            return res.status(404).json({ error: "No active cycle found." });
        }

        const results = raw.rows[0];
        const cycleLength = parseInt(results.avgcyclelength) || 28;

    
 
            const today = DateTime.now().startOf('day');
            const startDate = toDateTime(results.startdate).startOf('day');

            const diff = today.diff(startDate, 'days').days;
            const daysPast = Math.floor(diff);
            const cycleStatus = getCycleStatusFromDays(daysPast, cycleLength);
            const { currentDay, phase } = cycleStatus;

        res.json({ 
            day_in_cycle: currentDay, 
            phase: phase,
            days_since_start: daysPast 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database or Calculation Error" });
    }
});


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
        const cycleLength = parseInt(avgcyclelength) || 28;
        
        let predictions = [];
        
    
        let baseDate = toDateTime(startdate).startOf('day');

        for (let i = 1; i <= 6; i++) {
            
            const predictedStart = baseDate.plus({ days: cycleLength * i });
            
           
            const predictedEnd = predictedStart.plus({ days: 4 }); 

            predictions.push({
                period_number: i,
                estimated_start: predictedStart.toISODate(), 
                estimated_end: predictedEnd.toISODate()
            });
        }

        res.json(predictions);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Prediction failed", detail: err.message });
    }
});







app.post("/api/first-period", checkAuth, async (req, res) => {
    try {
        const { startDate } = req.body; 

    
        if (!startDate) {
            return res.status(400).json({ error: "startDate is required" });
        }

        const dateStr = typeof startDate === 'string' ? startDate.split('T')[0] : startDate;
        const [year, month, day] = dateStr.split('-').map(Number);
        const localDate = DateTime.local(year, month, day).startOf('day').toISODate();

        const insertPeriodQuery = `
            INSERT INTO period (userid, startdate, enddate) 
            VALUES ($1, $2, NULL) 
            RETURNING *
        `;
        
        const result = await pool.query(insertPeriodQuery, [req.userId, localDate]);

        res.json({
            message: "First period logged successfully",
            period: result.rows[0]
        });

    } catch (err) {
        console.error("Error logging first period:", err.stack);
        res.status(500).json({ error: "An error occurred", detail: err.message });
    }
});



app.post("/api/new-period", checkAuth, async (req, res) => {
    const client = await pool.connect(); 
    try {
        const { startDate } = req.body; 
        
        
        const dateStr = typeof startDate === 'string' ? startDate.split('T')[0] : startDate;
        const [year, month, day] = dateStr.split('-').map(Number);
        const startDt = DateTime.local(year, month, day).startOf('day');
        const todayStr = startDt.toISODate(); 

        await client.query('BEGIN'); 

        
        const yesterdayStr = startDt.minus({ days: 1 }).toISODate(); 

        const closeQuery = `
            UPDATE period
            SET enddate = $1 
            WHERE userid = $2 AND enddate IS NULL
        `;
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
                
                const d1 = toDateTime(history.rows[i].startdate);
                const d2 = toDateTime(history.rows[i + 1].startdate);
                
              
                const diff = d1.diff(d2, 'days').days;
                totalDays += Math.round(diff);
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


app.post('/api/assistant', checkAuth, async (req, res) => {
    try {
        if (!assistantModel) return res.status(503).json({ error: 'AI not initialized.' });

        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'No message provided.' });

        const cycleContext = await getCycleContext(req.userId);
        const contextStr = cycleContext
            ? `Day ${cycleContext.currentDay} (${cycleContext.phase}).`
            : 'No cycle data.';

        // Call the global model
        const result = await assistantModel.generateContent(`Context: ${contextStr}\nUser: ${message}`);
        res.json({ reply: result.response.text() });

    } catch (err) {
        console.error('Assistant Error:', err);
        const status = err.status || 500;
        res.status(status).json({ error: err.message || 'AI Error' });
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
                p.avgcyclelength,
                (SELECT startdate FROM period 
                 WHERE userid = $1 AND startdate <= s.logged_at 
                 ORDER BY startdate DESC LIMIT 1) as period_start,
                (SELECT enddate FROM period 
                 WHERE userid = $1 AND startdate <= s.logged_at 
                 ORDER BY startdate DESC LIMIT 1) as period_end
            FROM SYMPTOMDECODER s
            JOIN profiles p ON s.userid = p.id
            WHERE s.userid = $1 
            ORDER BY s.logged_at DESC 
            LIMIT 10
        `;
        
        const results = await pool.query(query, [req.userId]);

        if (results.rows.length === 0) {
            return res.status(404).send("No symptom logs found.");
        }

        const avgCycle = results.rows[0].avgcyclelength || "Not set";
        const doc = new PDFDocument();
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=symptom_report.pdf');

        doc.pipe(res); 

        
        doc.fontSize(22).text('Symptom Log Report', { align: 'center' });
        doc.fontSize(12).text(`Average Cycle Length: ${avgCycle} days`, { align: 'center' });
        doc.moveDown(2);

        
        results.rows.forEach(log => {
            
            const logDate = DateTime.fromJSDate(log.logged_at).toLocaleString(DateTime.DATE_MED);
            const pStart = log.period_start 
                ? DateTime.fromJSDate(log.period_start).toLocaleString(DateTime.DATE_MED) 
                : "N/A";
            const pEnd = log.period_end 
                ? DateTime.fromJSDate(log.period_end).toLocaleString(DateTime.DATE_MED) 
                : "Present";

            doc.fontSize(10).fillColor('gray').text(`Logged on: ${logDate}`);
            doc.fontSize(14).fillColor('black').text(`${log.symptomname}`, { continued: true });
            doc.fontSize(12).text(`  (Severity: ${log.severity}/10)`);
            
            doc.fontSize(10).fillColor('#444').text(`Cycle Period: ${pStart} to ${pEnd}`);
            doc.moveDown(0.2);
            doc.strokeColor('#eee').moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown(0.8);
        });

        doc.end();
    } catch (err) {
        console.error("PDF Generation Error:", err);
        res.status(500).send("An error occurred while generating the PDF.");
    }
});


app.get('/api/trends', checkAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const currentContext = await getCycleContext(userId); 

        if (!currentContext) {
            return res.status(200).json({ 
                has_trend: false, 
                message: "No active cycle found. Log your period start date to see trends!" 
            });
        }

        const { currentDay } = currentContext;

        const trendQuery = `
            WITH LoggedDays AS (
                SELECT 
                    s.symptomname,
                    (EXTRACT(DAY FROM (s.logged_at - pd.startdate))::int + 1) as cycle_day
                FROM symptomdecoder s
                JOIN period pd ON s.userid = pd.userid
                WHERE s.userid = $1 
                  AND s.logged_at >= pd.startdate 
                  AND (pd.enddate IS NULL OR s.logged_at <= pd.enddate + INTERVAL '25 days')
            )
            SELECT symptomname, COUNT(*) as frequency
            FROM LoggedDays
            WHERE cycle_day = $2
            GROUP BY symptomname
            HAVING COUNT(*) >= 2;
        `;

        const results = await pool.query(trendQuery, [userId, currentDay]);

        if (results.rows.length > 0) {
            const symptoms = results.rows.map(r => r.symptomname).join(", ");
            res.json({
                has_trend: true,
                current_day: currentDay,
                phase: currentContext.phase,
                message: `Heads up! You usually report ${symptoms} around day ${currentDay}.`,
                suggested_symptoms: results.rows.map(r => r.symptomname)
            });
        } else {
            res.json({
                has_trend: false,
                current_day: currentDay,
                phase: currentContext.phase,
                message: `You're on day ${currentDay} (${currentContext.phase}). No specific patterns detected yet.`
            });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not calculate trends" });
    }
});









app.listen(PORT , (req,res)=> {
    console.log('running')
})