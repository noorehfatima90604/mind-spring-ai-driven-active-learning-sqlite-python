import os
import chromadb
import easyocr
import numpy as np
import fitz  # PyMuPDF
from PIL import Image
from sentence_transformers import SentenceTransformer

# --- CONFIGURATION ---
BOOK_ID = "computer_10th"
PDF_NAME = "computer_10th.pdf"
# Using the full path you confirmed earlier
PDF_PATH = r"E:\mindspring2_project\textbooks\computer_10th.pdf"
DB_PATH = f"./db_storage/{BOOK_ID}_db"

print(f"--- STARTING MINDSPRING INGESTION ---")

# Load Models
embed_model = SentenceTransformer('all-MiniLM-L6-v2')
reader = easyocr.Reader(['en'], gpu=False)

# Setup Database
client = chromadb.PersistentClient(path=DB_PATH)
collection = client.get_or_create_collection(name=BOOK_ID)

try:
    # This is the part that replaces Poppler
    doc = fitz.open(PDF_PATH)
    print(f"✅ Successfully opened: {PDF_NAME}")
    print(f"📄 Total Pages to process: {len(doc)}")

    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        pix = page.get_pixmap()
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        
        # OCR to get text
        text = " ".join(reader.readtext(np.array(img), detail=0))
        
        if len(text.strip()) > 5:
            vector = embed_model.encode(text).tolist()
            collection.add(
                ids=[f"p{page_num+1}"], 
                embeddings=[vector], 
                documents=[text]
            )
            print(f"Done: Page {page_num+1}")

    print(f"\n✨ {BOOK_ID} is now searchable in MindSpring!")

except Exception as e:
    print(f"\n❌ Error: {e}")
    print("Tip: Make sure the PDF is not open in Microsoft Edge while running this.")