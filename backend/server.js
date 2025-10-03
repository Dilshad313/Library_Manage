// backend/server.js
// Enhanced with CORS support, better error handling, and flexible configuration

const port = process.env.PORT || 3000;
const http = require("http");
const fs = require("fs");
const url = require("url");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");
const crypto = require("crypto");

// MongoDB configuration - supports environment variables or defaults
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/";
const client = new MongoClient(MONGO_URI);
const UPLOAD_DIR = path.join(__dirname, "../frontend/uploads");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function genToken() {
  return crypto.randomBytes(24).toString("hex");
}

const serveStatic = (res, filepath, contentType) => {
  try {
    const data = fs.readFileSync(filepath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600"
    });
    res.end(data);
  } catch (err) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
};

const app = http.createServer(async (req, res) => {
  // CORS headers - Allow all origins (configure as needed for production)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  try {
    await client.connect(); // Ensure connected (idempotent)
    const db = client.db("LibrarySystemDB");
    const Books = db.collection("Books");
    const Members = db.collection("Members");
    const Users = db.collection("Users");
    const BorrowLogs = db.collection("BorrowLogs");

    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    // Static file serving
    if (pathname === "/") {
      return serveStatic(res, path.join(__dirname, "../frontend/index.html"), "text/html");
    }
    if (pathname.startsWith("/pages/")) {
      return serveStatic(res, path.join(__dirname, "../frontend", pathname), "text/html");
    }
    if (pathname.startsWith("/css/")) {
      return serveStatic(res, path.join(__dirname, "../frontend", pathname), "text/css");
    }
    if (pathname.startsWith("/js/")) {
      return serveStatic(res, path.join(__dirname, "../frontend", pathname), "application/javascript");
    }
    if (pathname.startsWith("/uploads/")) {
      const ext = path.extname(pathname).toLowerCase();
      const contentTypes = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp"
      };
      return serveStatic(res, path.join(__dirname, "../frontend", pathname), contentTypes[ext] || "image/jpeg");
    }

    // Helper to parse body
    const getBody = (req) =>
      new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk.toString()));
        req.on("end", () => resolve(body));
        req.on("error", reject);
      });

    // Error handler wrapper
    const sendError = (res, status, message) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, msg: message }));
    };

    // --- Authentication ---
    if (pathname === "/signup" && req.method === "POST") {
      const body = await getBody(req);
      const data = JSON.parse(body);
      
      if (!data.email || !data.password || !data.name) {
        return sendError(res, 400, "Missing required fields");
      }
      
      const existing = await Users.findOne({ email: data.email });
      if (existing) {
        return sendError(res, 400, "User already exists");
      }
      
      const user = {
        name: data.name,
        email: data.email,
        password: hashPassword(data.password),
        role: data.role || "member",
        token: null,
        createdAt: new Date()
      };
      await Users.insertOne(user);
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, msg: "User created successfully" }));
    }

    if (pathname === "/login" && req.method === "POST") {
      const body = await getBody(req);
      const data = JSON.parse(body);
      
      if (!data.email || !data.password) {
        return sendError(res, 400, "Email and password required");
      }
      
      const user = await Users.findOne({ email: data.email });
      if (!user || user.password !== hashPassword(data.password)) {
        return sendError(res, 401, "Invalid email or password");
      }
      
      const token = genToken();
      await Users.updateOne({ _id: user._id }, { $set: { token, lastLogin: new Date() } });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        ok: true,
        token,
        user: { name: user.name, email: user.email, role: user.role, id: user._id }
      }));
    }

    // Middleware: Get authenticated user
    const authUserFromReq = async (req) => {
      const auth = req.headers["authorization"];
      if (!auth) return null;
      const token = auth.replace("Bearer ", "");
      const user = await Users.findOne({ token });
      return user || null;
    };

    // --- Upload Cover ---
    if (pathname === "/uploadCover" && req.method === "POST") {
      try {
        const body = await getBody(req);
        const data = JSON.parse(body);
        
        if (!data.base64) {
          return sendError(res, 400, "No image data provided");
        }
        
        const base64 = data.base64.replace(/^data:image\/\w+;base64,/, "");
        const ext = (data.filename && path.extname(data.filename)) || ".jpg";
        const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
        const filepath = path.join(UPLOAD_DIR, filename);
        
        fs.writeFileSync(filepath, Buffer.from(base64, "base64"));
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true, path: `/uploads/${filename}` }));
      } catch (err) {
        console.error("Upload error:", err);
        return sendError(res, 500, "Failed to upload image");
      }
    }

    // --- BOOKS CRUD ---
    if (pathname === "/books" && req.method === "GET") {
      const books = await Books.find().sort({ createdAt: -1 }).toArray();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(books));
    }

    if (pathname === "/books" && req.method === "POST") {
      const body = await getBody(req);
      const data = JSON.parse(body);
      
      if (!data.title || !data.author) {
        return sendError(res, 400, "Title and author are required");
      }
      
      const book = {
        title: data.title,
        author: data.author,
        genre: data.genre || "Unknown",
        year: parseInt(data.year) || null,
        isbn: data.isbn || null,
        cover: data.cover || "/uploads/default-book.jpg",
        status: "Available",
        borrowedBy: null,
        dueDate: null,
        borrowCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const result = await Books.insertOne(book);
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, id: result.insertedId }));
    }

    if (pathname === "/books" && req.method === "PUT") {
      const body = await getBody(req);
      const data = JSON.parse(body);
      
      if (!data.id) {
        return sendError(res, 400, "Book ID is required");
      }
      
      const _id = new ObjectId(data.id);
      const update = {
        title: data.title,
        author: data.author,
        genre: data.genre,
        year: parseInt(data.year) || null,
        isbn: data.isbn || null,
        updatedAt: new Date()
      };
      
      if (data.cover) update.cover = data.cover;
      
      // Remove undefined fields
      Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);
      
      const result = await Books.updateOne({ _id }, { $set: update });
      
      if (result.matchedCount === 0) {
        return sendError(res, 404, "Book not found");
      }
      
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, msg: "Book updated successfully" }));
    }

    if (pathname === "/books" && req.method === "DELETE") {
      const body = await getBody(req);
      const id = body.trim();
      
      if (!id) {
        return sendError(res, 400, "Book ID is required");
      }
      
      const _id = new ObjectId(id);
      const book = await Books.findOne({ _id });
      
      if (!book) {
        return sendError(res, 404, "Book not found");
      }
      
      // Delete cover image if it exists
      if (book.cover && book.cover.startsWith("/uploads/") && !book.cover.includes("default")) {
        const diskPath = path.join(__dirname, "../frontend", book.cover);
        if (fs.existsSync(diskPath)) {
          try {
            fs.unlinkSync(diskPath);
          } catch (err) {
            console.error("Failed to delete image:", err);
          }
        }
      }
      
      await Books.deleteOne({ _id });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, msg: "Book deleted successfully" }));
    }

    // --- MEMBERS CRUD ---
    if (pathname === "/members" && req.method === "GET") {
      const members = await Members.find().sort({ createdAt: -1 }).toArray();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(members));
    }

    if (pathname === "/members" && req.method === "POST") {
      const body = await getBody(req);
      const data = JSON.parse(body);
      
      if (!data.name || !data.email) {
        return sendError(res, 400, "Name and email are required");
      }
      
      const existing = await Members.findOne({ email: data.email });
      if (existing) {
        return sendError(res, 400, "Member with this email already exists");
      }
      
      const member = {
        name: data.name,
        email: data.email,
        role: data.role || "student",
        borrowedBooks: [],
        createdAt: new Date()
      };
      const r = await Members.insertOne(member);
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, id: r.insertedId }));
    }

    if (pathname === "/members" && req.method === "PUT") {
      const body = await getBody(req);
      const data = JSON.parse(body);
      
      if (!data.id) {
        return sendError(res, 400, "Member ID is required");
      }
      
      const _id = new ObjectId(data.id);
      await Members.updateOne(
        { _id },
        { $set: { name: data.name, email: data.email, role: data.role, updatedAt: new Date() } }
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, msg: "Member updated successfully" }));
    }

    if (pathname === "/members" && req.method === "DELETE") {
      const body = await getBody(req);
      const id = body.trim();
      
      if (!id) {
        return sendError(res, 400, "Member ID is required");
      }
      
      const _id = new ObjectId(id);
      await Members.deleteOne({ _id });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, msg: "Member deleted successfully" }));
    }

    // --- BORROW & RETURN ---
    if (pathname === "/borrow" && req.method === "POST") {
      const body = await getBody(req);
      const data = JSON.parse(body);
      const bId = new ObjectId(data.bookId);
      const mId = new ObjectId(data.memberId);
      const days = parseInt(data.days) || 7;
      
      const book = await Books.findOne({ _id: bId });
      const member = await Members.findOne({ _id: mId });
      
      if (!book || !member) {
        return sendError(res, 404, "Book or member not found");
      }
      
      if (book.status === "Borrowed") {
        return sendError(res, 400, "Book is already borrowed");
      }
      
      const borrowedOn = new Date();
      const dueDate = new Date(borrowedOn.getTime() + days * 24 * 60 * 60 * 1000);
      
      await Books.updateOne(
        { _id: bId },
        { $set: { status: "Borrowed", borrowedBy: mId.toString(), dueDate }, $inc: { borrowCount: 1 } }
      );
      await Members.updateOne(
        { _id: mId },
        { $push: { borrowedBooks: { bookId: bId.toString(), borrowedOn, dueDate } } }
      );
      await BorrowLogs.insertOne({
        bookId: bId.toString(),
        memberId: mId.toString(),
        borrowedOn,
        dueDate,
        returnedOn: null,
        fine: 0
      });
      
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, dueDate }));
    }

    if (pathname === "/return" && req.method === "POST") {
      const body = await getBody(req);
      const data = JSON.parse(body);
      const bId = new ObjectId(data.bookId);
      const mId = new ObjectId(data.memberId);
      
      const book = await Books.findOne({ _id: bId });
      if (!book) {
        return sendError(res, 404, "Book not found");
      }
      
      if (book.status !== "Borrowed") {
        return sendError(res, 400, "Book is not currently borrowed");
      }
      
      const now = new Date();
      const due = new Date(book.dueDate);
      let fine = 0;
      
      if (now > due) {
        const daysLate = Math.ceil((now - due) / (24 * 60 * 60 * 1000));
        fine = daysLate * 5; // ₹5 per day
      }
      
      await Books.updateOne(
        { _id: bId },
        { $set: { status: "Available", borrowedBy: null, dueDate: null } }
      );
      await Members.updateOne(
        { _id: mId },
        { $pull: { borrowedBooks: { bookId: bId.toString() } } }
      );
      await BorrowLogs.updateOne(
        { bookId: bId.toString(), memberId: mId.toString(), returnedOn: null },
        { $set: { returnedOn: now, fine } }
      );
      
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, fine }));
    }

    // --- REPORTS ---
    if (pathname === "/reports/most-borrowed" && req.method === "GET") {
      const top = await Books.find().sort({ borrowCount: -1 }).limit(10).toArray();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(top));
    }

    if (pathname === "/reports/active-members" && req.method === "GET") {
      const agg = await BorrowLogs.aggregate([
        { $group: { _id: "$memberId", borrowCount: { $sum: 1 } } },
        { $sort: { borrowCount: -1 } },
        { $limit: 10 }
      ]).toArray();
      
      const result = await Promise.all(
        agg.map(async (a) => {
          const mem = await Members.findOne({ _id: new ObjectId(a._id) }).catch(() => null);
          return { memberId: a._id, borrowCount: a.borrowCount, member: mem };
        })
      );
      
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result));
    }

    // Default 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, msg: "Endpoint not found" }));
  } catch (error) {
    console.error("Server error:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, msg: "Internal server error" }));
  }
});

client.connect().then(() => {
  app.listen(port, () => {
    console.log(`LibrarySystem backend running at http://localhost:${port}/`);
    console.log(`MongoDB connected to ${MONGO_URI}`);
  });
}).catch(err => {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});