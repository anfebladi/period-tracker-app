import {Pool} from "pg";
import dotenv from "dotenv";
dotenv.config();


if (!process.env.DATABASE_URL) {
        console.log("couldnt connect to db")
}
export const pool  = new Pool({
    connectionString : process.env.DATABASE_URL,
    ssl : {
        rejectUnauthorized : false 
    }

})