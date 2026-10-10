<div align="center">

<img src="./applogo.png" alt="Hisapp logo" width="96" />

# 🦷 HishApp — Dental Clinic Income & Settlement Tracker

### আপনার ডেন্তাল ক্লিনিকের আয়, হিস্যা ও সেটেলমেন্ট — এখন এক অ্যাপে!
### *The percentage-based income ledger built for dental surgeons in Bangladesh.* 🇧🇩

**Live app / লাইভ অ্যাপ:** <https://hishapp1.web.app/>

[Install as an App](#-user-manual--ইউজার-ম্যানুয়াল) · [Features](#-features--ফিচারসমূহ) · [How the 40% Works](#-how-the-share--হিস্যা-works) · [For Developers](#-for-developers--ডেভেলপারদের-জন্য)

*No app store. No subscription. No desktop. Just open it in Chrome, install it like an app, and start counting your money — even with no internet.*

</div>

---

## 💡 Why HishApp? / কেন HishApp?

If you are a dental surgeon working in a clinic in Bangladesh, you already know the struggle:

> *"Clinic ৬০% রাখে, আমি ৪০% পাই। কিন্তু প্রতিদিন খাতায় লিখে, মাস শেষে হিসাব মেলাতে গিয়ে হিমশিম খাই। কত পেন্ডিং, কত বকেয়া — মনে থাকে না!"*

**HishApp solves exactly this.** *(Banglish: apni jodi daily patient-er bill likhen ar month-sheshe clinic-er kach theke apnar share bujhe pete chan, Hisapp apnar kaj 10x shohoj kore dibe.)*

- ✅ **Enter a visit in ~5 seconds** — patient name, treatment, collected amount. Hisapp instantly computes **your share** (40% by default).
- ✅ **Never lose a taka** — unpaid dues automatically **carry forward** to the next settlement. `বকেয়া আর মনে রাখতে হবে না!`
- ✅ **Works 100% offline** — data lives safely on your phone (IndexedDB) and backs up to *your own* Google Drive when you're online.
- ✅ **One-tap formal statements** — export any settlement as a clean **JPG image** or a formatted **monthly PDF** to send to the clinic owner on WhatsApp.

No cloud account is forced on you, no data leaves your device unless *you* sign in with your own Gmail.

---

## ✨ Features / ফিচারসমূহ

| Feature | What it does | বাংলায় |
|---|---|---|
| 📥 **Rapid Entry** | Patient + procedure + amount with smart suggestions & duplicate guard | রোগীর নাম লিখলেই আগের ভিজিট সাজেশন আসে |
| 🔢 **Auto share calculation** | Live doctor's share (default 40%) & clinic retention | টাকা দিলেই আপনার হিস্যা সাথে সাথে দেখায় |
| 📅 **Date stepper** | ◀ ▶ arrows beside the date to jump a day back/forward | তীর ছুঁয়ে আগের/পরের দিনে যান |
| 🔁 **Follow-up preset** | One tap sets procedure = Follow-up and amount = ৳0 | ফলো-আপ ভিজিটে টাকা ০ বসে যায় |
| 📒 **Records & profiles** | Searchable ledger + per-patient history, edit/delete with audit trail | রোগীর পুরনো হিস্ট্রি এক ট্যাপে |
| 💰 **Carry-forward settlement** | Batch-settle pending visits; dues roll over automatically | বকেয়া পরের সেটেলমেন্টে চলে যায় |
| 🖼️ **JPG statement export** | Formal settlement image for WhatsApp / printing | সেটেলমেন্টের ছবি এক ট্যাপে ডাউনলোড |
| 📄 **Monthly PDF report** | Formatted summary with share, volume & outstanding due | মাসিক অফিসিয়াল রিপোর্ট PDF |
| 📊 **Dashboard** | Earnings trend, procedure breakdown, recent records | মাসের আয়ের গ্রাফ |
| ☁️ **Gmail + Drive backup** | Automatic, encrypted-to-you backup in `Hisapp_Backups/` | ফোন বদলালেও ডেটা হারাবে না |
| 📶 **Offline-first PWA** | Installs to home screen, runs with zero internet | ইন্টারনেট ছাড়াই চলে |

---

<div align="center">

# 📘 USER MANUAL / ইউজার ম্যানুয়াল
### *(ধাপে ধাপে — একদম শুরু থেকে)*

</div>

নিচের ধাপগুলো অনুসরণ করলে **৫ মিনিটের মধ্যে** আপনি Hisapp ব্যবহার শুরু করে দিতে পারবেন। 🙌

### ধাপ ১ — Chrome-এ অ্যাপটি খুলুন
আপনার মোবাইল ফোনে **Google Chrome** ব্রাউজার খুলুন এবং অ্যাড্রেস বারে লিখুন:

```
https://hishapp1.web.app/
```

*(English: Open Chrome on your phone and go to the link above. The app loads instantly — nothing to download from any store.)*

### ধাপ ২ — অ্যাপ হিসেবে ইনস্টল করুন (Add to Home Screen)
1. Chrome-এর ডান-পাশের উপরের **⋮ (তিনটা ডট / মেনু)** বাটনে ট্যাপ করুন।
2. মেনু থেকে **"Install app"** অথবা **"Add to Home screen"** / **"অ্যাপ ইনস্টল করুন"** এ ট্যাপ করুন।
3. **Install / Add** চাপলেই Hisapp আপনার হোম স্ক্রিনে একটি আইকন হিসেবে চলে আসবে। ✅

> 💡 অ্যাপের ভেতরে উপরের ডান দিকেও একটি **Install** বাটন আছে — ওটা ছুঁলেও ইনস্টল হয়ে যাবে।
> এখন থেকে Hisapp খুলবে **একদম আসল অ্যাপের মতো** (full-screen, নিজস্ব আইকন) এবং **ইন্টারনেট না থাকলেও** চলবে।

### ধাপ ৩ — নিজের Gmail দিয়ে সাইন ইন করুন
1. অ্যাপ খুলে উপরের ডান কোনায় **⚙️ Settings** এ ট্যাপ করুন।
2. **"Sign in with Google (Gmail)"** বাটনে ট্যাপ করে **নিজের Gmail অ্যাকাউন্ট** বাছুন।
3. ব্যস! এখন থেকে আপনার সব ডেটা স্বয়ংক্রিয়ভাবে **আপনার নিজের Google Drive**-এর `Hisapp_Backups/` ফোল্ডারে ব্যাকআপ হবে। ☁️

> 🔒 **গোপনীয়তা:** Hisapp শুধু আপনার Drive-এর নিজস্ব ব্যাকআপ ফোল্ডারটি দেখতে পায় — আপনার অন্য কোনো ফাইল নয়। আপনার Gmail-ই আপনার অ্যাকাউন্ট; আলাদা কোনো পাসওয়ার্ড লাগে না।

### ধাপ ৪ — ব্যবহার শুরু করুন! 🎉

**📥 Entry ট্যাব — প্রতিদিনের ভিজিট লিখুন**
1. **Visit Date** পাশের **◀ ▶ তীর** ছুঁয়ে সঠিক দিন বাছুন (অথবা Today / Y'day)।
2. **Patient Name** লিখুন — আগের রোগী হলে নাম সাজেশন আসবে, ট্যাপ করে অটো-ফিল করুন।
3. **Dental Procedure** বাছুন (RCT, Filling, Scaling…) অথবা **Follow-up** — Follow-up বাছলে **Received Amount নিজে থেকেই ৳0** বসবে।
4. **Received Amount** দিন — চাইলে প্রিসেট বাটন (+৫০০, +১০০০…) বা **No Payment / Free Campaign / Follow-up (৳0)** ছুঁন।
5. **Save Record** চাপুন — নিচে সাথে সাথে আপনার **৪০% হিস্যা** দেখাবে। ✅

**📒 Records ট্যাব — সব হিসাব এক জায়গায়**
- রোগীর নাম লিখে সার্চ করুন, যেকোনো রেকর্ড **Edit/Delete** করুন (ভুলে মুছে ফেললে **Undo** আছে!)।
- প্রতিটি রোগীর মোট ভিজিট, মোট বিল ও আপনার মোট হিস্যা দেখুন।

**💰 Settlement ট্যাব — টাকা বুঝে নিন**
1. তারিখের রেঞ্জ বাছুন (All / This Month / 14 days / Week)।
2. ক্লিনিক থেকে কত টাকা পেলেন লিখুন — বাকি **বকেয়া (Due)** নিজে থেকেই হিসাব হয়ে **পরের সেটেলমেন্টে** চলে যাবে।
3. **Confirm Settlement** চাপুন। তারপর যেকোনো সেটেলমেন্টের পাশের **🖼️ আইকন** ছুঁয়ে **JPG স্টেটমেন্ট** ডাউনলোড/শেয়ার করুন — ক্লিনিক মালিককে WhatsApp-এ পাঠিয়ে দিন! 📤

**📊 Dashboard ট্যাব — আয়ের অবস্থা এক নজরে**
- আজ/এই মাসে আপনার মোট হিস্যা, পেন্ডিং ও বকেয়া, ৭/৩০ দিনের আয়ের গ্রাফ এবং কোন ট্রিটমেন্টে কত আয় তা দেখুন।

### 💬 ব্যবহারের উদাহরণ (Use cases)
- **দৈনিক এন্ট্রি:** প্রতি রোগীর পর ৫ সেকেন্ডে এন্ট্রি — মাস শেষে হিসাবের টেনশন নেই।
- **ফলো-আপ রোগী:** এক ট্যাপে Follow-up (৳0) — হিসাব গুলিয়ে যাবে না।
- **মাসিক সেটেলমেন্ট:** ক্লিনিকের সাথে বসে PDF/JPG স্টেটমেন্ট খুলে হিসাব মেলাও — স্বচ্ছ ও পেশাদার।
- **ফোন বদল / হারালে:** নতুন ফোনে একই Gmail দিয়ে সাইন ইন করলেই Drive থেকে সব ডেটা ফিরে আসবে।

> 🎯 **টিপ:** Settings-এ গিয়ে আপনার **ক্লিনিকের নাম, লোগো, ডাক্তারের নাম, হিস্যার % (যেমন ৪০%) ও কারেন্সি** নিজের মতো বদলে নিতে পারবেন।

---

## 🔢 How the Share / হিস্যা Works

Every entry stores the **full collected amount**, then splits it by your configured percentage (default **40% doctor / 60% clinic**):

```
Received ৳1,000  →  Doctor (40%) = ৳400   Clinic (60%) = ৳600
```

At settlement, Hisapp totals the doctor's share for the chosen period, adds any **previous due**, subtracts what the clinic actually paid, and **carries the balance forward** — so your ledger is always truthful.

---

## 🛠️ For Developers / ডেভেলপারদের জন্য

```bash
npm install        # install dependencies
npm run dev        # start dev server on :3000
npm test           # run the unit test suite (node --test)
npm run lint       # type-check (tsc --noEmit)
npm run build      # production build
```

**Cloud backup config:** paste your Firebase web-app config into `src/config/firebase.ts` (instructions are inside that file) to enable Gmail sign-in + Google Drive backup. The app runs fully offline without it.

**Deploy:** push to GitHub — `.github/workflows/firebase-deploy.yml` deploys to Firebase Hosting (`hishapp1.web.app`) automatically.

### Project structure (high level)
```
src/
  components/   # EntryTab, SettlementTab, RecordsTab, DashboardTab, modals…
  db/           # IndexedDB layer (offline-first local ledger)
  services/     # backupEngine, firebaseAuth, driveBackup, cloudSync…
  utils/        # pdfExport, settlementImageExport (JPG), followUp, dateUtils…
  types/        # shared TypeScript models
```

---

## ❓ FAQ / সচরাচর জিজ্ঞাসা

- **ইন্টারনেট ছাড়া কি চলবে?** হ্যাঁ! পুরো অ্যাপ offline-first; ইন্টারনেট এলে Drive-এ ব্যাকআপ হয়।
- **আমার ডেটা কি কেউ দেখতে পারবে?** না — ডেটা আপনার ফোনে ও আপনার নিজের Drive-এ থাকে।
- **হিস্যার % বদলানো যাবে?** হ্যাঁ, Settings-এ share percentage ও currency বদলানো যায়।
- **ভুলে রেকর্ড মুছে ফেললে?** Undo বাটন আছে, আর Audit Trail-এ সব পরিবর্তনের ইতিহাস থাকে।

---

<div align="center">

**Hisapp** — *হিসাব রাখুন ঝামেলামুক্ত, মন দিন চিকিৎসায়।* 💙
Made with ❤️ by **Dr. Munabbir**, for the BDS Doctors of Bangladesh.

[Open Hisapp →](https://hishapp1.web.app/)

</div>
