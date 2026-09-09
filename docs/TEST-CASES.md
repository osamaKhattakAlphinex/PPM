# Test cases

Every module, written in plain language, to be run by hand after the build is
complete. No technical knowledge is needed — each case says what to do and what
should happen. If what happens is different, the case has failed.

---

## Before you start

### 1. Set up

```bash
pnpm install
cp .env.example .env.local      # fill in MONGODB_URI and AUTH_SECRET
pnpm seed
pnpm dev
```

Open http://localhost:3000.

### 2. The test accounts

`pnpm seed` creates one user for each role. They all share the password
**`ChangeMe!2026`** unless you set `SEED_PASSWORD`.

| Role | Email | What this person can do |
|---|---|---|
| ADMIN | `admin@ppm.local` | Everything |
| FM_MANAGER | `fm@ppm.local` | Everything except system administration |
| SUPERVISOR | `supervisor@ppm.local` | Day-to-day operations, no money |
| TECHNICIAN | `tech@ppm.local` | Their own jobs only |
| CLIENT | `client@ppm.local` | Their own data only, read-only |

> These five accounts are for testing only. A real deployment has none of them
> — see the pre-launch checklist in `docs/DEPLOYMENT.md`.

### 3. How to record a result

Write **Pass** or **Fail** in the last column. For a failure, write what you saw
instead. A case is a Pass only if the expected result happens exactly — "it
mostly worked" is a Fail with a note.

### 4. A word about the two languages

Every screen exists twice, in English at `/en/...` and Arabic at `/ar/...`.
Section 16 tests Arabic on its own. While testing everything else, stay in
English unless a case says otherwise.

---

## 1. Sign in and sign out

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 1.1 | Sign in works | Go to the site, click Sign in, enter `admin@ppm.local` and the password | You reach the dashboard and your name is in the top bar | |
| 1.2 | Wrong password is refused | Sign in with the right email and a wrong password | You stay on the login page with a message. The message must NOT say whether the email exists | |
| 1.3 | Unknown email looks the same | Sign in with `nobody@nowhere.com` and any password | The same message as 1.2, word for word | |
| 1.4 | Empty form | Click Sign in with both boxes empty | The form asks for both, nothing is sent | |
| 1.5 | Too many attempts are blocked | Enter the wrong password for the same email 6 times in a row | The 6th attempt is refused with a "try again later" message, and the right password is also refused until the wait is over | |
| 1.6 | Sign out works | Sign out, then press the browser Back button | You do NOT see the app again. You are sent to the login page | |
| 1.7 | Signed-out people cannot open the app | While signed out, type `/en/app/assets` in the address bar | You are sent to the login page | |
| 1.8 | After signing in you return where you wanted | While signed out, open `/en/app/assets`, then sign in | You land on the assets page, not the dashboard | |
| 1.9 | Session survives a refresh | Sign in and press F5 | You are still signed in | |

---

## 2. Who can see what (roles)

Sign in as each role in turn and look at the left navigation.

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 2.1 | ADMIN sees everything | Sign in as ADMIN | Dashboard, Assets, Preventive, Corrective, Checklists, AMC, Reports, Approvals, Invoicing, Technicians, Clients, Locations, AI Insights | |
| 2.2 | FM_MANAGER sees everything operational | Sign in as FM_MANAGER | The same list as ADMIN | |
| 2.3 | SUPERVISOR has no money screens | Sign in as SUPERVISOR | No AMC, no Invoicing, no AI Insights. Reports, Approvals and Technicians are there | |
| 2.4 | TECHNICIAN sees only their work | Sign in as TECHNICIAN | My Jobs, Assets, Preventive, Corrective, Checklists, Locations. No Approvals, no Invoicing, no Reports | |
| 2.5 | TECHNICIAN lands on My Jobs | Sign in as TECHNICIAN | The first page after sign-in is My Jobs, not the dashboard | |
| 2.6 | CLIENT lands on the portal | Sign in as CLIENT | The first page after sign-in is the portal | |
| 2.7 | CLIENT sees a short list | Sign in as CLIENT | Assets, Corrective, AMC, Reports, Invoicing, Locations. No Technicians, no Checklists, no Preventive | |
| 2.8 | Typing a forbidden address does not work | As TECHNICIAN, type `/en/app/invoicing` in the address bar | You are refused or sent away. You do NOT see invoices | |
| 2.9 | Same for a client | As CLIENT, type `/en/app/technicians` | You are refused or sent away | |
| 2.10 | Same for a supervisor | As SUPERVISOR, type `/en/app/ai-insights` | You are refused or sent away | |

---

## 3. Clients and locations

Sign in as ADMIN.

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 3.1 | Add a client | Clients → Add, fill the name and contact details, save | The client appears in the list straight away | |
| 3.2 | Required fields are checked | Try to save a client with an empty name | It refuses and points at the name box | |
| 3.3 | Bad email is refused | Enter `not-an-email` as the contact email | It refuses before saving | |
| 3.4 | Edit a client | Change the client's phone number and save | The new number shows in the list | |
| 3.5 | Search works | Type part of a client name in the search box | Only matching clients remain | |
| 3.6 | Add a location | Locations → Add, give it a name, a city and a client, save | It appears in the list with the client's name shown | |
| 3.7 | A location must belong to a real client | Add a location and leave the client empty | It refuses, or saves with no client if the field is optional — whichever the form says, it must not save a broken link | |
| 3.8 | Delete a client | Delete the client you made in 3.1 | It disappears from the list and does not come back on refresh | |
| 3.9 | Paging | If there are more than one page of rows, click to page 2 and back | The list changes and the page number is in the address bar, so a refresh keeps your place | |

---

## 4. Assets

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 4.1 | Add an asset | Assets → Add. Name "Chiller 1", category HVAC, pick a location and a client, save | It appears in the register | |
| 4.2 | Category must be one of the list | Try to save without choosing a category | It refuses | |
| 4.3 | Filter by category | Choose HVAC in the filter | Only HVAC assets remain | |
| 4.4 | Filter by status | Choose Maintenance | Only assets in maintenance remain | |
| 4.5 | Search by name | Type "Chiller" | Only matching assets remain | |
| 4.6 | Filters stay after refresh | With a filter on, press F5 | The same filter is still applied | |
| 4.7 | Edit an asset | Change the asset's status to Maintenance and save | The new status shows in the list, with the right colour | |
| 4.8 | Asset health | Look at the health figure on an asset | It shows a number or a bar, and assets in worse condition sort lower when you sort by health | |
| 4.9 | Delete an asset | Delete "Chiller 1" | It is gone from the list | |
| 4.10 | A client sees only their own | Note which client owns an asset. Sign in as CLIENT and open Assets | You see only assets belonging to that client's company. Assets of other clients are not in the list at all | |

---

## 5. Preventive maintenance (PPM)

Sign in as SUPERVISOR or above.

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 5.1 | Create a schedule | Preventive → Add. Pick an asset, frequency Monthly, a due date next week, a technician. Save | It appears in the list as Scheduled | |
| 5.2 | Every frequency is offered | Open the frequency list | Daily, Weekly, Monthly, Quarterly, Semi-annual, Annual (or whatever the list shows — all must be selectable) | |
| 5.3 | Upcoming is marked | Create a schedule due in 3 days | It shows as **Upcoming** | |
| 5.4 | Overdue is marked | Create a schedule with a due date in the past | It shows as **Overdue**, in a warning colour | |
| 5.5 | Overdue is worked out, not stored | Create a schedule due tomorrow, then change your computer's date forward by a week and refresh | It now shows Overdue with nobody having edited it | |
| 5.6 | Start a job | Open a scheduled job and start it | The status becomes In progress | |
| 5.7 | Complete a job | Complete the job in progress | The status becomes Completed and the completion date is recorded | |
| 5.8 | A completed job is not overdue | Look at a completed job whose due date has passed | It shows Completed, not Overdue | |
| 5.9 | Filter by status | Filter to Overdue | Only overdue jobs remain | |
| 5.10 | Calendar view | Open the calendar, if the module offers one | Jobs appear on their due dates and the month can be changed | |
| 5.11 | Delete a schedule | Delete the one you made | It is gone | |
| 5.12 | A client cannot see this at all | Sign in as CLIENT and try `/en/app/preventive` | You are refused or sent away | |

---

## 6. Corrective maintenance (work orders)

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 6.1 | Raise a work order | Corrective → Add. Pick an asset, write a fault, priority High. Save | It appears as **Open** with no technician | |
| 6.2 | Priority colours | Create one of each priority: Critical, High, Medium, Low | Each shows a different, sensible colour, Critical the strongest | |
| 6.3 | Assign it | Assign the open ticket to a technician | The status becomes **Assigned** and the name shows | |
| 6.4 | An open ticket cannot be closed | Look at the buttons on an Open ticket | There is **no** Close button. A ticket must be assigned to somebody before it can be closed | |
| 6.5 | Start work | Start the assigned ticket | The status becomes **In progress** | |
| 6.6 | Put it on hold | Put the in-progress ticket on hold | The status becomes **Pending** | |
| 6.7 | Resume it | Resume the pending ticket | It goes back to In progress | |
| 6.8 | Close it | Close the in-progress ticket | The status becomes **Closed** and the closing time is recorded | |
| 6.9 | A closed ticket is final | Look at a closed ticket | There is no button to reopen it. A ticket closed in error must be raised again as a new one | |
| 6.10 | Hand it back | Take an assigned ticket and unassign it | It returns to Open | |
| 6.11 | Filter by status | Filter to Open | Only open tickets remain | |
| 6.12 | Filter by priority | Filter to Critical | Only critical tickets remain | |
| 6.13 | Send for approval | On a closed ticket, send it for approval | It appears in the Approvals queue (section 8) | |
| 6.14 | A client can raise but not act | Sign in as CLIENT and open Corrective | You can see your own tickets. You cannot assign or close anybody's | |

---

## 7. Checklists

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 7.1 | Build a checklist | Checklists → Add. Name it, category HVAC, add 4 items, mark 2 as required. Save | It appears in the list showing 4 items | |
| 7.2 | An empty checklist is refused | Try to save a checklist with no items | It refuses | |
| 7.3 | Reorder items | Move an item up or down and save | The new order sticks after a refresh | |
| 7.4 | Run a checklist | Start a run of the checklist against a job | A run opens with every item unticked | |
| 7.5 | Tick items | Tick some items and add a note to one | The ticks and the note are saved without pressing a separate Save, or with one if the screen has it — either way they survive a refresh | |
| 7.6 | Required items must be done | Try to complete a run with a required item unticked | It refuses and says which item is missing | |
| 7.7 | Complete a run | Tick everything required, then complete | The run shows Completed with the finish time | |
| 7.8 | Progress is visible | Look at a half-finished run | It shows how many of how many are done | |
| 7.9 | Delete a checklist | Delete the one you made | It is gone. Existing runs of it are not broken | |

---

## 8. Approvals

This is a chain. Each stage is approved by the role that owns it, in order:
**Technician → Supervisor → FM Manager → Client → Invoice**.

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 8.1 | An item enters the chain | Send a closed work order for approval (case 6.13) | It appears in Approvals at the **Technician** stage, Pending | |
| 8.2 | Only the right role can act | Sign in as SUPERVISOR while the item is at the Technician stage | You can see it but you cannot approve it | |
| 8.3 | The owner can act | Sign in as TECHNICIAN and approve it | It moves to the **Supervisor** stage | |
| 8.4 | Next stage | As SUPERVISOR, approve it | It moves to **FM Manager** | |
| 8.5 | And the next | As FM_MANAGER, approve it | It moves to **Client** | |
| 8.6 | An admin cannot approve for the client | As ADMIN, try to approve at the Client stage | You cannot. An admin may stand in at staff stages, never at the client's | |
| 8.7 | The client approves | As CLIENT, approve it | It moves to **Invoice**, ready to bill | |
| 8.8 | Stages cannot be skipped | At any stage, try to jump two stages forward (by any means the screen offers) | It is refused. Approval moves exactly one step at a time | |
| 8.9 | Reject | Send a second item into the chain and reject it at the Supervisor stage | It shows Rejected with the reason, and goes no further | |
| 8.10 | A reason is required to reject | Try to reject with an empty reason | It refuses | |
| 8.11 | The history is kept | Open an item that has been through three stages | You can see who approved what and when, oldest first, and nothing has been overwritten | |
| 8.12 | Progress is shown | Look at any item in the chain | A progress indicator shows which stage it is at, out of how many | |

---

## 9. AMC contracts

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 9.1 | Create a contract | AMC → Add. Client, contract number, type Comprehensive, value 120,000 SAR, start today, end in one year. Save | It appears as **Active** | |
| 9.2 | Money is shown properly | Look at the value | It shows as SAR with thousands separators and two decimals, not as a raw number | |
| 9.3 | A future contract is Upcoming | Create one starting next month | It shows **Upcoming**, not Active | |
| 9.4 | Expiring is flagged | Create one ending in 30 days | It shows **Expiring**, in a warning colour | |
| 9.5 | 61 days is not expiring | Create one ending in 90 days | It shows Active. The expiring window is 60 days | |
| 9.6 | An ended contract | Create one that ended last month | It shows Expired and is not counted as active | |
| 9.7 | Suspend and cancel | Suspend an active contract, then cancel it | The status changes each time and the buttons offered change with it | |
| 9.8 | End must be after start | Try to save with the end date before the start date | It refuses | |
| 9.9 | Totals | Look at the summary figures on the page | The total contract value matches the sum of the contracts listed | |
| 9.10 | A client sees only their contracts | Sign in as CLIENT and open AMC | Only that client's contracts. Read-only — no Add, no Edit | |

---

## 10. Invoicing and VAT

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 10.1 | Raise an invoice | Invoicing → Add. Client, amount 1,000.00 SAR, due in 30 days. Save | It appears as **Pending** | |
| 10.2 | VAT is calculated for you | Look at the invoice you just made | VAT shows **150.00** and the total **1,150.00**. You were never asked to type either | |
| 10.3 | VAT cannot be typed in | Look at the create form again | There is no box for VAT, none for the total, none for the rate | |
| 10.4 | Rounding | Create an invoice for 33.33 SAR | VAT is 5.00 and the total 38.33 — rounded to the halala, never a fraction of one | |
| 10.5 | Zero is allowed, negative is not | Try an amount of 0, then of −100 | 0 is accepted; −100 is refused | |
| 10.6 | Bill from an approval | Take the item that reached the Invoice stage in 8.7 and raise an invoice from it | An invoice is created linked to that approval, and the approval is marked as invoiced | |
| 10.7 | It cannot be billed twice | Try to raise a second invoice from the same approval | It is refused | |
| 10.8 | Overdue | Create an invoice with a due date in the past | It shows **Overdue** in a warning colour, without anybody editing it | |
| 10.9 | Mark as paid | Settle an invoice | It shows **Paid**, and stops showing Overdue even if the due date has passed | |
| 10.10 | Download the PDF | Download an invoice PDF | It opens, shows the client, the line, the VAT at 15% and the total, and the Arabic text renders properly (not as boxes) | |
| 10.11 | You cannot download somebody else's | Copy the PDF address of one client's invoice. Sign in as a different client and open it | You get "not found" or "not allowed" — never the PDF | |
| 10.12 | Summary figures | Look at the totals on the invoicing page | Outstanding, paid and overdue add up to what is listed | |

---

## 11. Technicians and attendance

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 11.1 | Add a technician | Technicians → Add. Name, trade HVAC, status Active, save | They appear in the list | |
| 11.2 | Filter by trade | Filter to HVAC | Only HVAC technicians remain | |
| 11.3 | Set on leave | Change one to On leave | The status shows and they are still in the list | |
| 11.4 | My Jobs shows only my jobs | Sign in as TECHNICIAN and open My Jobs | You see only jobs assigned to you. Another technician's jobs are not there | |
| 11.5 | Check in | Press Check in | Your status becomes On site and the time is recorded | |
| 11.6 | Location needs permission | Watch what happens when you check in | The screen asks before using your location. If you refuse, the check-in still works, just without a location | |
| 11.7 | Location is never taken silently | Refuse the browser's location request, then check in | It checks you in and stores no coordinates | |
| 11.8 | Check out | Press Check out | Your status becomes Checked out and the time is recorded | |
| 11.9 | One check-in a day | Try to check in twice on the same day | The second is refused or does nothing — one attendance record per person per day | |
| 11.10 | It works on a phone | Open My Jobs on a phone, or a narrow browser window | Everything is readable, the buttons are big enough to tap, nothing is cut off | |
| 11.11 | You cannot check in as somebody else | (Technical) The check-in form has no field for who you are | Confirmed — the person is taken from the sign-in, not from the page | |

---

## 12. Dashboard

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 12.1 | Figures are real | Sign in as ADMIN and note the number of open work orders. Go to Corrective and count them | The two numbers agree | |
| 12.2 | It changes with the data | Raise a new work order and go back to the dashboard | The count has gone up by one | |
| 12.3 | The doughnut | Look at the work-order status chart | The slices add up to the total, and the legend names each status | |
| 12.4 | The trend | Look at the maintenance trend chart | It shows the last few months, planned and reactive told apart | |
| 12.5 | PPM compliance | Look at the compliance figure | It is a percentage of jobs completed out of jobs that fell due. If nothing has fallen due, it shows a dash, not 0% or 100% | |
| 12.6 | Nothing is invented | On a fresh database with no data, open the dashboard | It shows zeroes and empty states, not example figures | |
| 12.7 | Charts do not slow the page | Open the dashboard and watch it load | The page appears first and the charts fill in, with a placeholder of the right height so nothing jumps | |
| 12.8 | Reduced motion | Turn on "reduce motion" in your operating system and reload | The counting-up animation does not run. The numbers are simply there | |
| 12.9 | The client's dashboard | Sign in as CLIENT | You see a portal with your own figures only — your assets, your tickets, your contracts | |

---

## 13. Reports

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 13.1 | The PM report | Reports → PM. | It lists preventive jobs with due dates, statuses and a compliance figure | |
| 13.2 | The asset report | Reports → Asset | It lists assets by category and condition, worst first | |
| 13.3 | The financial report | Reports → Financial as ADMIN | It shows contract values, invoiced and outstanding amounts | |
| 13.4 | A supervisor has no financial report | Sign in as SUPERVISOR and open Reports | PM and Asset are offered. Financial is not | |
| 13.5 | And cannot reach it by address | As SUPERVISOR, put `?report=FINANCIAL` in the address bar | You are refused. You do not see money | |
| 13.6 | The choice is in the address | Pick a report and copy the address into a new tab | The same report opens | |
| 13.7 | Download a report PDF | Download each report as a PDF | Each opens, is readable, and matches what is on screen | |
| 13.8 | A client's report is their own | Sign in as CLIENT and open a report | Only that client's rows appear | |

---

## 14. AI insights

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 14.1 | Without a key | With `ANTHROPIC_API_KEY` unset, open AI Insights as ADMIN | A polite "not configured" panel. No error, no crash | |
| 14.2 | With a key | Set the key, restart, open AI Insights, ask for an analysis | Text appears gradually, a few words at a time, and reads as advice about your actual data | |
| 14.3 | Only management | Sign in as SUPERVISOR and try `/en/app/ai-insights` | You are refused | |
| 14.4 | No private details are sent | (Technical, read `docs/SECURITY.md` §6) | The AI is sent counts and statuses only — no client names, no people's names, no money | |
| 14.5 | Cancelling stops it | Start an analysis and navigate away immediately | The request stops. It does not carry on in the background | |
| 14.6 | It cannot be spammed | Ask for an analysis 7 times in one minute | The 7th is refused with a "too many requests" message | |
| 14.7 | The key never reaches the browser | Open the browser's developer tools → Network, and run an analysis | No request contains the API key. It is used on the server only | |

---

## 15. Notifications

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 15.1 | Overdue PPM raises a notice | Create a PPM job due yesterday. Run the notification job (see `docs/DEPLOYMENT.md`) | The bell in the top bar shows a new notice about the overdue job | |
| 15.2 | Expiring contract raises a notice | Create a contract ending in 30 days and run the job again | A notice about the expiring contract appears | |
| 15.3 | Nothing is repeated | Run the job a second time without changing anything | No duplicate notice appears. The count stays the same | |
| 15.4 | Mark one as read | Open the bell and mark one notice read | The unread count goes down by one | |
| 15.5 | Mark all as read | Mark all read | The count goes to zero and stays there after a refresh | |
| 15.6 | Read by one person only | Mark a notice read as ADMIN, then sign in as FM_MANAGER | It is still unread for them | |
| 15.7 | The job needs its password | Call the job address without the secret | It refuses with 401 | |
| 15.8 | And with a wrong one | Call it with a wrong secret | It refuses in the same way | |
| 15.9 | With no secret configured | Unset `CRON_SECRET` and call the job | It answers 503 — it does not run unprotected | |

---

## 16. Arabic and right-to-left

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 16.1 | Switch language | Use the language switch on any page | The page reloads in Arabic at the `/ar/...` address, on the same screen | |
| 16.2 | The layout mirrors | Look at the Arabic app | Navigation is on the right, text reads right to left, arrows and chevrons point the other way | |
| 16.3 | Nothing is left in English | Walk through every module in Arabic | No English word is left in a label, a button, a table heading, an empty state or an error message | |
| 16.4 | Numbers and dates | Look at money and dates in Arabic | They are readable and correctly formatted, not reversed or broken | |
| 16.5 | Forms work in Arabic | Create an asset while in Arabic | It saves, and the error messages when you get it wrong are in Arabic | |
| 16.6 | PDFs in Arabic | Download an invoice while in Arabic | The Arabic renders as joined-up letters, not boxes or separate characters | |
| 16.7 | The language sticks | Move between pages after switching | You stay in Arabic. It does not fall back to English | |
| 16.8 | The public site too | Open `/ar` | The marketing pages are Arabic and mirrored | |

---

## 17. The public website

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 17.1 | The landing page | Open `/en` while signed out | A marketing page loads. It does not ask you to sign in | |
| 17.2 | Pricing | Open `/en/pricing` | Plans are shown with prices in SAR | |
| 17.3 | Contact | Open `/en/contact` | Contact details are shown. Tapping the phone number on a phone offers to call | |
| 17.4 | It is fast | Load the landing page | It appears almost immediately. There is no blank white wait | |
| 17.5 | The browser console is clean | Open developer tools → Console and reload | No red errors | |
| 17.6 | Robots | Open `/robots.txt` | It disallows `/app`, `/api` and `/style-guide` | |
| 17.7 | Sitemap | Open `/sitemap.xml` | It lists the three public pages in both languages, and **no** private page | |
| 17.8 | The app is not indexed | Sign in, view the page source of any app screen, look for "noindex" | It is there | |
| 17.9 | Mobile | Open the landing page on a phone | It reads well, nothing overflows sideways | |

---

## 18. Files and attachments

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 18.1 | Upload a photo | Open an asset's Files tab and upload a JPEG | It uploads and shows as a thumbnail | |
| 18.2 | Upload a PDF | Upload a PDF | It uploads and is listed with its name | |
| 18.3 | A dangerous file is refused | Try to upload an `.svg`, an `.exe` or a `.html` file | It is refused | |
| 18.4 | A renamed file is still refused | Rename an `.exe` to `.jpg` and upload it | It is still refused — the contents are checked, not the name | |
| 18.5 | Too big is refused | Try to upload a file over 10 MB | It is refused with a clear message | |
| 18.6 | An odd filename is handled | Upload a file named `../../etc/passwd.jpg` | It uploads and is shown with a safe, plain name | |
| 18.7 | Download works | Download a file you uploaded | It downloads and opens correctly | |
| 18.8 | Somebody else cannot download it | Copy the file's address, sign in as a different client, open it | You get "not found" or "not allowed" | |
| 18.9 | Signed out cannot either | Open the same address in a private window | You are sent to the login page. The file is never served | |
| 18.10 | Delete | Delete an attachment | It disappears and its address stops working | |

---

## 19. Data separation between companies

**The most important section in this document.** Everything else is a feature;
this is the promise.

You need a second organization. Create it as ADMIN, with its own client and its
own admin user, and put at least one asset, one work order and one invoice in
each of the two organizations.

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 19.1 | Lists are separate | Sign in to company A and open Assets. Then sign in to company B | Neither one sees the other's assets. Not greyed out — absent | |
| 19.2 | Counts are separate | Compare the dashboard figures | Each company's figures count only their own rows | |
| 19.3 | An address from the other company does not work | Copy the address of one of company A's assets (`/en/app/assets/<id>`). Sign in as company B and open it | You get "not found". Not the asset, and not an error that tells you it exists | |
| 19.4 | The same for work orders | Repeat 19.3 with a work order | "Not found" | |
| 19.5 | The same for invoices | Repeat 19.3 with an invoice | "Not found" | |
| 19.6 | And for files | Repeat 19.3 with an attachment | "Not found" | |
| 19.7 | Search does not leak | Search for a word that only appears in company A's data, while signed in as company B | No results | |
| 19.8 | Reports do not leak | Run every report in company B | No row belongs to company A | |
| 19.9 | Clients are separated further | With two clients in one company, sign in as client 1 and look at Assets, Corrective, AMC, Invoicing and Reports | You see only client 1's rows in every one of them | |
| 19.10 | A client cannot reach another client's record | Copy the address of client 2's invoice, open it as client 1 | "Not found" | |
| 19.11 | Deleting is scoped too | As company B, try to delete something belonging to company A by its address | Refused. Nothing is deleted | |

---

## 20. Security checks anyone can run

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 20.1 | Errors say nothing useful | Cause an error (for example, open `/en/app/assets/not-a-real-id`) | A friendly message. No database error, no file paths, no stack trace | |
| 20.2 | Extra fields are rejected | (Technical) Submit a form with an extra hidden field added in developer tools | The whole request is refused, not partly accepted | |
| 20.3 | Injection text is just text | Create an asset named `{"$ne": null}` and another named `<script>alert(1)</script>` | Both save as plain text and display as plain text. No pop-up appears anywhere | |
| 20.4 | Long input is capped | Paste 10,000 characters into a description | It is refused or trimmed. The page does not hang | |
| 20.5 | The session cookie is protected | Developer tools → Application → Cookies | The session cookie is marked HttpOnly. On an https site it is also Secure | |
| 20.6 | Cookies are not readable by scripts | In the console, type `document.cookie` | The session value is not there | |
| 20.7 | Security headers are set | Developer tools → Network → click the first document → Headers | You see `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`. On a live https site, also `Strict-Transport-Security` | |
| 20.8 | The framework is not advertised | In the same headers | There is no `X-Powered-By` | |
| 20.9 | No secret in the browser | Developer tools → Sources, search all files for `sk-ant-` | Nothing is found | |
| 20.10 | Writes are limited | Save the same form 130 times quickly | You are eventually refused with "too many requests" | |

---

## 21. Look, feel and accessibility

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 21.1 | Dark mode | Switch the theme | Everything stays readable. No white box on a dark page, no invisible text | |
| 21.2 | The theme sticks | Switch the theme and reload | It is remembered | |
| 21.3 | Keyboard only | Put the mouse aside and move through a page with Tab | Every button and link can be reached, and the one you are on is clearly outlined | |
| 21.4 | Forms by keyboard | Fill in and submit a form using only the keyboard | It works, including any drop-down | |
| 21.5 | Reduced motion | Turn on "reduce motion" and move around the app | Animations do not play. Nothing is broken by their absence | |
| 21.6 | Phone | Use the whole app on a phone | Nothing overflows sideways, buttons are big enough to tap, tables scroll rather than squash | |
| 21.7 | Tablet | Use the app at tablet width | The layout adapts sensibly — not a stretched phone, not a squeezed desktop | |
| 21.8 | Empty states | Open a module with nothing in it | A helpful message and a way to add the first item. Not a blank page | |
| 21.9 | Loading | Watch a slow page load | Something shows the page is working — a skeleton of about the right shape, not a jump | |
| 21.10 | Errors are human | Submit a form with several mistakes | Every mistake is named next to the box it belongs to, in plain language | |

---

## 22. The automatic tests

These run themselves. The point of listing them is that somebody has to look at
the result.

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 22.1 | Types | `pnpm typecheck` | Finishes with no errors | |
| 22.2 | Lint and the data rule | `pnpm lint:dal` | Finishes with no errors and no warnings | |
| 22.3 | The suite | `pnpm test` | All 54 suites pass. This needs a MongoDB — either let it download one, or point `MONGO_TEST_URI` at one you have | |
| 22.4 | The build | `pnpm build` | Finishes, and the public pages are listed as prerendered | |
| 22.5 | CI | Push the branch and open the pull request | The CI check goes green. If it is red, the branch cannot be merged | |

> **Known limitation while testing offline:** where the network blocks
> `fastdl.mongodb.org`, the 15 database suites cannot download their MongoDB and
> will not start. They are not failing — they never begin. Set `MONGO_TEST_URI`
> to any reachable MongoDB and they run. See `docs/SECURITY.md` §7.

---

## 23. User administration

Sign in as ADMIN and open the account menu (top right) → Administration.

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 23.1 | The directory | Open Administration | Every account in your company is listed with its name, email, role, status and creation date | |
| 23.2 | No password is shown | Look at the list, and at the page source | No password and no password hash appears anywhere | |
| 23.3 | Create a user | New user. Name, email, a 12-character password, role Supervisor. Save | The account appears in the list as **Invited** | |
| 23.4 | An invited account cannot sign in | Sign out and try to sign in as the new account | It is refused | |
| 23.5 | Activate it | Back as ADMIN, activate that account | It shows **Active** | |
| 23.6 | Now it can sign in | Sign in as the new account | It works, and the navigation matches its role | |
| 23.7 | Suspend it | As ADMIN, suspend that account | It shows **Suspended** | |
| 23.8 | A suspended account is shut out | Sign out and try to sign in as it | It is refused. (An account already signed in loses access within five minutes — see `docs/SECURITY.md`) | |
| 23.9 | Restore it | Activate it again | It shows Active and can sign in | |
| 23.10 | You cannot act on yourself | Look at your own row | It has no Activate or Suspend button — it says "You" | |
| 23.11 | A short password is refused | Try to create a user with a 6-character password | It refuses and says at least 12 characters | |
| 23.12 | A duplicate email is refused | Create a user with an email that already exists | It refuses. The message must NOT confirm which company already has it | |
| 23.13 | A client user needs a client | Choose the role Client in the form | A client picker appears, and it must be filled in | |
| 23.14 | A staff user has no client | Switch the role back to Supervisor | The client picker disappears, and the account saves without one | |
| 23.15 | A manager cannot create an administrator | Sign in as FM_MANAGER (if the route is open to them) and open the form | Administrator is not in the role list | |
| 23.16 | Filters | Filter by role, then by status, then search a name | Each filter narrows the list correctly, and they combine | |

---

## 24. Sign-up, invitations and your own account

| # | Test | What to do | What should happen | Result |
|---|---|---|---|---|
| 24.1 | Register a company | On the public site, click Start free. Fill in a company name, your name, an email and a 12-character password, tick the terms, submit | A new company is created, you are signed in as its administrator, and the workspace is empty | |
| 24.2 | Nothing is borrowed | Look around the new company | No assets, no clients, no jobs. Nothing from any other company is visible | |
| 24.3 | The terms box is required | Try to submit without ticking it | It refuses | |
| 24.4 | A short password is refused | Try a 6-character password | It refuses and asks for at least 12 | |
| 24.5 | A used email is refused neutrally | Register again with the same email | It is refused. The message must NOT say whether the email or the company already exists | |
| 24.6 | Repeated attempts are blocked | Register four times in a row from the same computer | The fourth is refused with a wait message | |
| 24.7 | Sign-up can be switched off | Set `SIGNUP_ENABLED=false`, restart, open the sign-up page | A polite closed notice instead of the form | |
| 24.8 | And is off at the endpoint too | With it off, submit the form anyway (for example by reloading a cached page) | Still refused. Not just hidden | |
| 24.9 | Arabic sign-up | Register from `/ar/signup` | The workspace opens in Arabic | |
| 24.10 | An invitation link | As administrator, add a colleague, then click Invite link on their row | A link is shown once, with a note that it is shown only once | |
| 24.11 | The colleague sets their own password | Open the link in a private window, choose a password, submit | They are signed in, and their account shows as Active | |
| 24.12 | The link works only once | Open the same link again | It says the link is no longer valid | |
| 24.13 | A new link cancels the old | Issue a second link for someone, then try the first | The first no longer works | |
| 24.14 | A tampered link fails | Change one character in the link and open it | The same "no longer valid" message. It must not say why | |
| 24.15 | Your own account | Sign in and open Account from the top-right menu | Your name, email, role, company and last sign-in are shown | |
| 24.16 | Change your name | Change your name and save | It is saved. The name in the top bar catches up within a few minutes | |
| 24.17 | Email cannot be edited | Look at the email box | It is shown but not editable, with a note saying why | |
| 24.18 | Change your password | Enter your current password and a new one twice | It is changed, and you can sign in with the new one | |
| 24.19 | The current password is required | Try to change it with the wrong current password | It refuses and says which field is wrong | |
| 24.20 | The confirmation must match | Enter two different new passwords | It refuses | |
| 24.21 | Signed in on the public site | While signed in, open the public home page | The header shows your name with a menu, not a Sign in button | |
| 24.22 | The menu works | Open it | It offers Go to the app and Sign out, and Escape closes it | |
| 24.23 | Sign out from the public site | Click Sign out there | You are signed out and stay on the public page | |
| 24.24 | The scenarios page | Open What it does from the public menu | Every module is listed with its scenarios, in plain language | |
| 24.25 | In Arabic too | Open the same page at `/ar/scenarios` | Fully Arabic and mirrored, with the same number of scenarios | |

---

## Sign-off

| Section | Cases | Passed | Failed | Tested by | Date |
|---|---|---|---|---|---|
| 1. Sign in and out | 9 | | | | |
| 2. Roles | 10 | | | | |
| 3. Clients and locations | 9 | | | | |
| 4. Assets | 10 | | | | |
| 5. Preventive | 12 | | | | |
| 6. Corrective | 14 | | | | |
| 7. Checklists | 9 | | | | |
| 8. Approvals | 12 | | | | |
| 9. AMC contracts | 10 | | | | |
| 10. Invoicing | 12 | | | | |
| 11. Technicians | 11 | | | | |
| 12. Dashboard | 9 | | | | |
| 13. Reports | 8 | | | | |
| 14. AI insights | 7 | | | | |
| 15. Notifications | 9 | | | | |
| 16. Arabic | 8 | | | | |
| 17. Public site | 9 | | | | |
| 18. Files | 10 | | | | |
| 19. Data separation | 11 | | | | |
| 20. Security | 10 | | | | |
| 21. Look and feel | 10 | | | | |
| 22. Automatic tests | 5 | | | | |
| 23. User administration | 16 | | | | |
| 24. Sign-up and account | 25 | | | | |
| **Total** | **255** | | | | |

**A release needs every case in section 19 to pass.** A failure there is not a
bug to schedule — it is one company seeing another company's data, and nothing
ships until it is fixed.
