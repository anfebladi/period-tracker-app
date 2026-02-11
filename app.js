
const PORT = 3000;
import { pool } from "./db.js"
import express from 'express'
import dotenv from 'dotenv'
dotenv.config()

const app = express()
app.use(express.json())


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
            ovulation = Math.floor(avgcyclelength / 2)
        } else {
            ovulation = avgcyclelength - 14;
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
        const { lastperiod, avgcyclelength } = raw.rows[0];

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
        await pool.query(updateQuery, [today, userId]);

        res.json({ 
            message: "Cycle updated Day 1 is now " + today,
            status: "Success"
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update cycle" });
    }
});