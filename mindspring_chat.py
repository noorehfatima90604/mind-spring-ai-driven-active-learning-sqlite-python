import os
import chromadb
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
import google.generativeai as genai

# 1. Setup - Load your API Key and Database
load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

# Configure the new stable library
genai.configure(api_key=api_key)
model = genai.GenerativeModel('gemini-3-flash-preview')

print("Connecting to MindSpring Database...")
db_path = "./mindspring_db"
client = chromadb.PersistentClient(path=db_path)
collection = client.get_or_create_collection(name="chemistry_data")

# Load the math model for searching
print("Loading Search Engine...")
embed_model = SentenceTransformer('all-MiniLM-L6-v2')

def ask_mindspring(question):
    # Phase A: Search the Database
    query_vector = embed_model.encode(question).tolist()
    results = collection.query(query_embeddings=[query_vector], n_results=3)
    
    # Get the text found in your textbook
    context_text = " ".join(results['documents'][0])
    
   # Phase B: Create the Prompt (The "Personality" of the AI)
    prompt = f"""
    You are MindSpring, a friendly and expert Chemistry Tutor for 10th-grade students.
    
    INSTRUCTIONS:
    1. Use the TEXTBOOK DATA below to answer the student's question.
    2. DO NOT just copy-paste the text. Instead, explain it in your own words.
    3. If the textbook text is complex, use a simple real-life analogy to explain it.
    4. Keep the tone encouraging and educational.
    5. If the answer isn't in the text, provide a general chemistry answer but mention it's based on general knowledge.
    
    TEXTBOOK DATA: {context_text}
    
    STUDENT QUESTION: {question}
    
    MINDSYPRING'S TUTOR RESPONSE:
    """
    # Phase C: Generate response using stable method
    response = model.generate_content(prompt)
    return response.text

# --- SIMPLE CHAT LOOP ---
print("\n✅ MindSpring is Online! (Type 'quit' to exit)")
while True:
    user_input = input("\nYou: ")
    if user_input.lower() in ['quit', 'exit', 'bye']:
        break
    
    print("\nMindSpring is thinking...", flush=True)
    try:
        answer = ask_mindspring(user_input)
        print(f"\nMindSpring: {answer}")
    except Exception as e:
        print(f"\n❌ Error: {e}")