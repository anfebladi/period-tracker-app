
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


app.get("/api", (req,res)=> {
    res.send('we working gang')
})
// get your status + current date
app.get('/api/period', async (req,res)=> {
    try {
        const getPeriodQuery = 'SELECT * FROM profiles WHERE id = 3';
        const raw = await pool.query(getPeriodQuery);
        const results = raw.rows[0]
        const today = new Date();
        const lastPeriod = new Date(results.lastperiod);
        const currentDayInMiliSeconds = today - lastPeriod;
        const daysPast = Math.floor(currentDayInMiliSeconds / (1000 * 60 * 60 * 24));
        const currentDay = (daysPast % results.avgcyclelength) + 1;
        let phase;
        let ovulation;
        // math to calculate phase 
        // if period shorter than 20 days we treat it as a short cycle
        if (results.avgcyclelength < 21) {
            ovulation = Math.floor(results.avgcyclelength / 2)
        } else {
            ovulation = results.avgcyclelength - 14;
        }

       if (currentDay <= 5) { 
            phase = "Menses";
        } else if (currentDay < ovulation - 2) {
            phase = "Follicular";
        } else if (currentDay >= ovulation - 2 && currentDay <= ovulation + 1) {
            phase = "Ovulation";
        } else {
            phase = "Luteal";
        }


        res.json({ "day you are on": currentDay, 
                    "your phase is: " : phase
                })

    } catch(err){
        res.json({error: "an error has ocurrec"})
    }

})

//symptom logger

app.post("/api/logger", async (req,res)=> {

    try {
        const {symptomname, severity} = req.body;
        if (!symptomname || !severity){
            return res.json({error: "please enter both symptom name and severity"})
        }
        const logSymptomQuery = "INSERT INTO SYMPTOMDECODER (symptomname, severity) VALUES ($1, $2)"
        const results = await pool.query(logSymptomQuery, [symptomname, severity])
        res.json("everything was logged sucesfully")
    } catch(err){
        res.json({error: "an error has ocurrec"})
    }

})


//new user
app.post("/api/newuser", async (req,res)=> {
    try {
        const {lastPeriod, avgcyclelength} = req.body
        if (!lastPeriod || !avgcyclelength) {
            return res.json({error: "please enter both your last period and your average cycle length"})
        }
        const insertUserQuery = 'INSERT INTO profiles (lastPeriod, avgcyclelength) VALUES ($1 , $2)';
        const results = await pool.query(insertUserQuery, [lastPeriod, avgcyclelength])
        res.json("profile succesfully created")
    } catch(err)  {
        res.json({error: "an error has ocurred when trying to create profile"})
    }
})



app.listen(PORT , (req,res)=> {
    console.log('running')
})

//next 6 periods predictor
// call this endpoint for calendar
app.get('/api/predictions', async (req, res) => {
    try {
        const queryToGetInfo = 'SELECT lastperiod, avgcyclelength FROM profiles WHERE id = 3'
        const results = await pool.query(queryToGetInfo);
        const { lastperiod, avgcyclelength } = results.rows[0];

        let predictions = [];
        let nextDate = new Date(lastperiod);

        for (let i = 0; i < 6; i++) {
            nextDate.setDate(nextDate.getDate() + avgcyclelength);
            
            predictions.push({
                period_number: i + 1,
                estimated_start: new Date(nextDate).toISOString().split('T')[0],
                estimated_end: "" // add 4 or 5 days to start date
            });
        }

        res.json(predictions);
    } catch (err) {
        res.status(500).json({ error: "Prediction failed" });
    }
});


// update period info
// Update the start date when a new period begins
app.put("/api/update-period", async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD

        const updateQuery = "UPDATE profiles SET lastperiod = $1 WHERE id = 3";
        await pool.query(updateQuery, [today]);

        res.json({ 
            message: "Cycle updated Day 1 is now " + today,
            status: "Success"
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update cycle" });
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