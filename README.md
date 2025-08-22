# psoriasis-severity-tracker
A web application that allows users with a confirmed psoriasis diagnosis to track their skin condition over time. Users can upload photos, view AI-generated severity scores, maintain a personal health profile including medications and dermatologist notes, and reflect on their treatment journey. 


This project is currently in development and will later integrate an AI model to assist with automated skin severity assessments.

🚀 Purpose:

The goal of this project is to provide users with an easy way to:

- Log photo entries of skin conditions.

- Track severity history over time.

- Add notes to entries for context.

- Visualize severity trends through a dashboard.

- (Future) Use AI to provide automated severity suggestions.

🛠️ Tech Stack:

- Frontend: React

- Backend / Database / Auth: Firebase

- Styling: Tailwind CSS (or your current styling choice)

- Version Control: Git + GitHub


⚙️ How to Run Locally

- Clone the repository:

git clone https://github.com/your-username/skin-severity-tracker.git
cd skin-severity-tracker/frontend


- Install dependencies:

npm install


- Set up Firebase config:

- - Create a file .env in the frontend/ directory.

- - dd your Firebase credentials (from your Firebase project settings):

REACT_APP_FIREBASE_API_KEY=your_api_key
REACT_APP_FIREBASE_AUTH_DOMAIN=your_auth_domain
REACT_APP_FIREBASE_PROJECT_ID=your_project_id
REACT_APP_FIREBASE_STORAGE_BUCKET=your_storage_bucket
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
REACT_APP_FIREBASE_APP_ID=your_app_id


- Run the development server:

npm start

- Visit the app:
Open http://localhost:3000
 in your browser.
 

📌 Current State:

✅ User authentication

✅ Dashboard for photo + severity tracking

✅ Notes system

✅ Average severity visualization

✅ Deletable entries (updates history + average)

⏳ AI model integration (in progress)

⏳ UI polishing + deployment

🔮 Roadmap:

 - Integrate AI skin severity assessment

-  Deploy live app (Firebase Hosting / Vercel)

 - Add user profile & history export

🤝 Contributing:

This is currently a personal school project, but feedback and suggestions are welcome!


