const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const cors = require('cors');

// Express App
const app = express();
require('dotenv').config();
const PORT = process.env.PORT || 8080;
const pool = new Pool({
  connectionString: process.env.connectionString,
});
// Middleware
app.use(cors({ origin: 'https://reservebooksystem.netlify.app/' }));
app.use(bodyParser.json());

// Initialize Seats (Run this once to create initial seats)
const initializeSeats = async () => {
  try {
    const seatCount = await pool.query('SELECT COUNT(*) FROM seats');
    if (parseInt(seatCount.rows[0].count, 10) === 0) {
      for (let row = 1; row <= 11; row++) {  // 11 rows
        for (let seat = 1; seat <= 7; seat++) {  // 7 seats per row
          await pool.query('INSERT INTO seats (row, "seat_Number") VALUES ($1, $2)', [row, seat]);
        }
      }
      for (let seat = 1; seat <= 3; seat++) { // 12th row with 3 seats
        await pool.query('INSERT INTO seats (row, "seat_Number") VALUES ($1, $2)', [12, seat]);
      }
      console.log('Seats initialized successfully');
    }
  } catch (err) {
    console.error('Error initializing seats:', err);
  }
};
initializeSeats();

// Routes

// User Signup
app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO userse (username, email, password) VALUES ($1, $2, $3) RETURNING id',
      [username, email, password]
    );
    res.status(201).json({ userId: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Email already in use' });
  }
});

app.get("/",(req,res)=>{
res.send("HI Here is backend this side");
}
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await pool.query('SELECT * FROM userse WHERE username = $1', [username]);

    if (user.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (password !== user.rows[0].password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ userId: user.rows[0].id, message: 'Login successful' });
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reserve Seats
app.post('/api/seats/reserve', async (req, res) => {
  const { userId, numberOfSeats } = req.body;
  try {
    // Fetch available seats from the database
    const availableSeats = await pool.query(
      'SELECT * FROM seats WHERE is_reserved = FALSE ORDER BY row, "seat_Number"'
    );

    if (availableSeats.rows.length < numberOfSeats) {
      return res.status(400).json({ error: 'Not enough seats available' });
    }

    const reservedSeats = [];
    let seatsReserved = false;

    // Loop through rows to find available adjacent seats
    for (let i = 1; i <= 12; i++) { // 12 rows
      let consecutiveAvailableSeats = 0;
      let rowReservedSeats = [];
      const seatLimit = i === 12 ? 3 : 7; // 12th row has 3 seats

      for (let j = 1; j <= seatLimit; j++) {
        const seat = availableSeats.rows.find(seat => seat.row == i && seat.seat_Number == j);
        if (seat && !seat.is_reserved) {
          consecutiveAvailableSeats++;
          rowReservedSeats.push({ row: i, seat_Number: j });

          if (consecutiveAvailableSeats === numberOfSeats) {
            break;
          }
        } else {
          consecutiveAvailableSeats = 0;
          rowReservedSeats = [];
        }
      }

      if (rowReservedSeats.length === numberOfSeats) {
        seatsReserved = true;
        await Promise.all(
          rowReservedSeats.map(seat =>
            pool.query('UPDATE seats SET is_reserved = TRUE, reserved_by = $1 WHERE row = $2 AND "seat_Number" = $3', [
              userId,
              seat.row,
              seat.seat_Number,
            ])
          )
        );
        reservedSeats.push(...rowReservedSeats);
        break;
      }
    }

    if (!seatsReserved) {
      const are = [];

      // Gather available seats by row
      for (let i = 1; i <= 12; i++) {
        const rowSeats = availableSeats.rows.filter((ar) => ar.row == i);
        are.push({ rowno: i, len: rowSeats.filter(seat => !seat.is_reserved).length });
      }

      // Sort by the number of available seats in descending order
      are.sort((a, b) => b.len - a.len);


      let remainingSeats = numberOfSeats;

      // Try reserving seats row by row
      for (let re of are) {
        if (remainingSeats > 0) {
          const rowSeats = availableSeats.rows.filter((seat) => seat.row === re.rowno && !seat.is_reserved);
          const seatsToReserve = rowSeats.slice(0, remainingSeats);

          remainingSeats -= seatsToReserve.length;

          // Update the reserved seats in the database
          await Promise.all(
            seatsToReserve.map((seat) =>
              pool.query('UPDATE seats SET is_reserved = TRUE, reserved_by = $1 WHERE row = $2 AND "seat_Number" = $3', [
                userId,
                seat.row,
                seat.seat_Number,
              ])
            )
          );

          reservedSeats.push(...seatsToReserve);
        }
      }

      if (remainingSeats > 0) {
        return res.status(400).json({ error: 'Unable to reserve the required number of seats nearby' });
      }
    }

    // Fetch updated seat status after reservation
    const updatedSeats = await pool.query('SELECT * FROM seats ORDER BY row, "seat_Number"');
const totalseatsreserved=await pool.query('SELECT *FROM seats WHERE is_reserved=TRUE');
const numberofseatsreserved=totalseatsreserved.rows.length;
console.log(numberofseatsreserved);
    const arr = Array.from({ length: 12 }, (_, i) =>
      Array.from({ length: i === 11 ? 3 : 7 }, (_, j) => {
        const seat = updatedSeats.rows.find(sea => sea.row == i + 1 && sea.seat_Number == j + 1);
        return {
          book: seat ? seat.is_reserved : false,
        };
      })
    );

    res.json({
      message: 'Seats reserved successfully',
    numberofseatsreserved,
      arr,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error reserving seats' });
  }
});

// Get Seat Status
app.post('/api/seats/reset', async (req, res) => {
  const { userId } = req.body; // Expect `userId` in the request body

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // Reset seats for the specific user
    const result = await pool.query('DELETE FROM seats WHERE userid = $1', [userId]);
    const updatedSeats = await pool.query('SELECT * FROM seats ORDER BY row, "seat_Number"');
    const totalseatsreserved=await pool.query('SELECT *FROM seats WHERE is_reserved=TRUE');
    const numberofseatsreserved=totalseatsreserved.rows.length;
    console.log(numberofseatsreserved);
        const arr = Array.from({ length: 12 }, (_, i) =>
          Array.from({ length: i === 11 ? 3 : 7 }, (_, j) => {
            const seat = updatedSeats.rows.find(sea => sea.row == i + 1 && sea.seat_Number == j + 1);
            return {
              book: seat ? seat.is_reserved : false,
            };
          })
        );
    
        res.json({
          message: 'Seats reserved successfully',
        numberofseatsreserved,
          arr,
        });
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error resetting seats for the user' });
  }
});

// Cancel Reservation
app.post('/api/seats/cancel', async (req, res) => {
  const { userId } = req.body;
  try {
    await pool.query(
      'UPDATE seats SET is_reserved = FALSE, reserved_by = NULL WHERE reserved_by = $1',
      [userId]
    );
    res.json({ message: 'Reservation cancelled successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error canceling reservation' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
