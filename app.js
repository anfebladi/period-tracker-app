
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
        if (currentDay < 6) {
            phase = "Menses"
        } else if (currentDay < 14){
            phase = "Follicular"
        } else if (currentDay == 14){
            phase = "Ovulation"
        } else {
            phase = "Luteal"
        }
        res.json({"day you are on": currentDay, "your phase is: " : phase})
    } catch(err){
        res.json({error: "an error has ocurrec"})
    }

})

//symptom logger

app.post("/api/logger", async (req,res)=> {

    try {
        const {symptomnate, severity} = req.body;
        if (!symptomnate || !severity){
            res.json({error: "please enter both symptom name and severity"})
        }
        const logSymptomQuery = "INSERT INTO SYMPTOMDECODER (symptomname, severity) VALUES ($1, $2)"
        const results = await pool.query(logSymptomQuery, [symptomnate, severity])
        res.json("everything was logged sucesfully")
    } catch(err){
        res.json({error: "an error has ocurrec"})
    }

})

app.listen(PORT , (req,res)=> {
    console.log('running')
})

