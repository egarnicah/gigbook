from google import genai
import os
import sys

def main():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("Error: No se encontro la API Key.")
        sys.exit(1)

    # Configuramos el cliente
    client = genai.Client(api_key=api_key)
    
    prompt = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "Hola"
    
    # Intentamos con los 3 nombres de modelos mas probables en 2026
    modelos_a_probar = ["gemini-1.5-flash-latest", "gemini-1.5-flash", "gemini-2.0-flash"]
    
    exito = False
    for nombre_modelo in modelos_a_probar:
        try:
            response = client.models.generate_content(
                model=nombre_modelo, 
                contents=prompt
            )
            print(f"\n[Modelo usado: {nombre_modelo}]")
            print(f"{response.text}\n")
            exito = True
            break
        except Exception as e:
            continue
            
    if not exito:
        print("\n--- ERROR DE CONEXION ---")
        print("Google no responde a los modelos estandar.")
        print("Tip: Revisa en https://aistudio.google.com/ si tu API Key esta activa")
        print("o si necesitas aceptar nuevos terminos y condiciones para 2026.")

if __name__ == "__main__":
    main()
