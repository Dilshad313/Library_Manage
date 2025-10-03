// backend/server.js
const port = 3000;
const http = require("http");
const fs = require("fs");
const url = require("url");
const queryString = require("querystring");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");
const crypto = require("crypto");

const client = new MongoClient("mongodb://127.0.0.1:27017/");
const UPLOAD_DIR = path.join(__dirname, "../frontend/uploads");

// ensure upload dir exists
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
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end("Not found");
  }
};

const app = http.createServer(async (req, res) => {
  await client.connect(); // ensure connected (idempotent)
  const db = client.db("LibrarySystemDB");
  const Books = db.collection("Books");
  const Members = db.collection("Members");
  const Users = db.collection("Users"); // auth users (admin/member)
  const BorrowLogs = db.collection("BorrowLogs"); // history

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
    return serveStatic(res, path.join(__dirname, "../frontend", pathname), "image/jpeg");
  }

  // Helpers to parse body
  const getBody = (req) =>
    new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk.toString()));
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });

  // --- Authentication ---
  if (pathname === "/signup" && req.method === "POST") {
    const body = await getBody(req);
    const data = JSON.parse(body);
    const existing = await Users.findOne({ email: data.email });
    if (existing) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, msg: "User exists" }));
    }
    const user = {
      name: data.name,
      email: data.email,
      password: hashPassword(data.password),
      role: data.role || "member", // admin / member
      token: null,
    };
    await Users.insertOne(user);
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (pathname === "/login" && req.method === "POST") {
    const body = await getBody(req);
    const data = JSON.parse(body);
    const user = await Users.findOne({ email: data.email });
    if (!user || user.password !== hashPassword(data.password)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, msg: "Invalid credentials" }));
    }
    const token = genToken();
    await Users.updateOne({ _id: user._id }, { $set: { token } });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, token, user: { name: user.name, email: user.email, role: user.role, id: user._id } }));
  }

  // middleware-like: get user by token header
  const authUserFromReq = async (req) => {
    const auth = req.headers["authorization"];
    if (!auth) return null;
    const token = auth.replace("Bearer ", "");
    const user = await Users.findOne({ token });
    return user || null;
  };

  // --- Upload cover (expects JSON: { filename, base64 }) ---
  if (pathname === "/uploadCover" && req.method === "POST") {
    try {
      const body = await getBody(req);
      const data = JSON.parse(body);
      const base64 = data.base64.replace(/^data:image\/\w+;base64,/, "");
      const ext = (data.filename && path.extname(data.filename)) || ".jpg";
      const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
      const filepath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(filepath, Buffer.from(base64, "base64"));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, path: `/uploads/${filename}` }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, err: err.message }));
    }
  }

  // --- BOOKS CRUD ---
  if (pathname === "/books" && req.method === "GET") {
    const books = await Books.find().toArray();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(books));
  }

  if (pathname === "/books" && req.method === "POST") {
    // expects JSON body with book fields, optionally cover path
    const body = await getBody(req);
    const data = JSON.parse(body);
    const book = {
      title: data.title,
      author: data.author,
      genre: data.genre,
      year: data.year,
      isbn: data.isbn || null,
      cover: data.cover || "/uploads/default-book.jpg",
      status: "Available",
      borrowedBy: null,
      dueDate: null,
      borrowCount: 0,
      createdAt: new Date(),
    };
    const result = await Books.insertOne(book);
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, id: result.insertedId }));
  }

  if (pathname === "/books" && req.method === "PUT") {
    const body = await getBody(req);
    const data = JSON.parse(body);
    if (!data.id) { res.writeHead(400); return res.end("missing id"); }
    const _id = new ObjectId(data.id);
    const update = {
      title: data.title,
      author: data.author,
      genre: data.genre,
      year: data.year,
      isbn: data.isbn || null,
      cover: data.cover || undefined,
    };
    // remove undefined fields
    Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);
    await Books.updateOne({ _id }, { $set: update });
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("success");
  }

  if (pathname === "/books" && req.method === "DELETE") {
    const body = await getBody(req);
    const id = body.trim();
    if (!id) { res.writeHead(400); return res.end("missing id"); }
    const _id = new ObjectId(id);
    const book = await Books.findOne({ _id });
    if (book && book.cover && book.cover.startsWith("/uploads/")) {
      const diskPath = path.join(__dirname, "../frontend", book.cover);
      if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
    }
    await Books.deleteOne({ _id });
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("success");
  }

  // --- MEMBERS CRUD ---
  if (pathname === "/members" && req.method === "GET") {
    const members = await Members.find().toArray();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(members));
  }

  if (pathname === "/members" && req.method === "POST") {
    const body = await getBody(req);
    const data = JSON.parse(body);
    const member = {
      name: data.name,
      email: data.email,
      role: data.role || "student",
      borrowedBooks: [],
      createdAt: new Date(),
    };
    const r = await Members.insertOne(member);
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, id: r.insertedId }));
  }

  if (pathname === "/members" && req.method === "PUT") {
    const body = await getBody(req);
    const data = JSON.parse(body);
    const _id = new ObjectId(data.id);
    await Members.updateOne({ _id }, { $set: { name: data.name, email: data.email, role: data.role } });
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("success");
  }

  if (pathname === "/members" && req.method === "DELETE") {
    const body = await getBody(req);
    const id = body.trim();
    const _id = new ObjectId(id);
    await Members.deleteOne({ _id });
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("success");
  }

  // --- BORROW & RETURN ---
  // Borrow: POST JSON { bookId, memberId, days } -> sets dueDate, status, increments borrowCount
  if (pathname === "/borrow" && req.method === "POST") {
    const body = await getBody(req);
    const data = JSON.parse(body);
    const bId = new ObjectId(data.bookId);
    const mId = new ObjectId(data.memberId);
    const days = parseInt(data.days) || 7;
    const book = await Books.findOne({ _id: bId });
    const member = await Members.findOne({ _id: mId });
    if (!book || !member) { res.writeHead(404); return res.end(JSON.stringify({ ok: false, msg: "Book or member not found" })); }
    if (book.status === "Borrowed") { res.writeHead(400); return res.end(JSON.stringify({ ok: false, msg: "Book already borrowed" })); }
    const borrowedOn = new Date();
    const dueDate = new Date(borrowedOn.getTime() + days * 24 * 60 * 60 * 1000);
    await Books.updateOne({ _id: bId }, { $set: { status: "Borrowed", borrowedBy: mId.toString(), dueDate }, $inc: { borrowCount: 1 } });
    await Members.updateOne({ _id: mId }, { $push: { borrowedBooks: { bookId: bId.toString(), borrowedOn, dueDate } } });
    await BorrowLogs.insertOne({ bookId: bId.toString(), memberId: mId.toString(), borrowedOn, dueDate, returnedOn: null });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, dueDate }));
  }

  // Return: POST JSON { bookId, memberId } -> calculates fine
  if (pathname === "/return" && req.method === "POST") {
    const body = await getBody(req);
    const data = JSON.parse(body);
    const bId = new ObjectId(data.bookId);
    const mId = new ObjectId(data.memberId);
    const book = await Books.findOne({ _id: bId });
    if (!book) { res.writeHead(404); return res.end(JSON.stringify({ ok: false, msg: "Book not found" })); }
    if (book.status !== "Borrowed") { res.writeHead(400); return res.end(JSON.stringify({ ok: false, msg: "Book not borrowed" })); }
    const now = new Date();
    const due = new Date(book.dueDate);
    let fine = 0;
    if (now > due) {
      const daysLate = Math.ceil((now - due) / (24 * 60 * 60 * 1000));
      fine = daysLate * 5; // ₹5 per day (example)
    }
    // Update book
    await Books.updateOne({ _id: bId }, { $set: { status: "Available", borrowedBy: null, dueDate: null } });
    // Remove from member borrowedBooks
    await Members.updateOne({ _id: mId }, { $pull: { borrowedBooks: { bookId: bId.toString() } } });
    // Update borrow log
    await BorrowLogs.updateOne({ bookId: bId.toString(), memberId: mId.toString(), returnedOn: null }, { $set: { returnedOn: now, fine } });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, fine }));
  }

  // --- REPORTS ---
  if (pathname === "/reports/most-borrowed" && req.method === "GET") {
    // return top 10 by borrowCount
    const top = await Books.find().sort({ borrowCount: -1 }).limit(10).toArray();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(top));
  }

  if (pathname === "/reports/active-members" && req.method === "GET") {
    // members who have borrowed the most (by length of borrowedBooks or borrow logs)
    const agg = await BorrowLogs.aggregate([
      { $group: { _id: "$memberId", borrowCount: { $sum: 1 } } },
      { $sort: { borrowCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "Members",
          localField: "_id",
          foreignField: "_id",
          as: "member"
        }
      }
    ]).toArray();
    // attach member info (some drivers return _id as string; fallback to fetching)
    const result = await Promise.all(agg.map(async a => {
      const mem = await Members.findOne({ _id: new ObjectId(a._id) }).catch(()=>null);
      return { memberId: a._id, borrowCount: a.borrowCount, member: mem };
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(result));
  }

  // default
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Endpoint not found");
});

client.connect().then(() => {
  app.listen(port, () => {
    console.log(`LibrarySystem backend running at http://localhost:${port}/`);
  });
});
