import ijson
import sys
import os

def validate_json_array(file_path):
    try:
        file_path = os.path.abspath(file_path)
        print(f"🔍 Validation du fichier : {file_path}")

        # Vérifie que le fichier existe
        if not os.path.exists(file_path):
            print("❌ Le fichier n'existe pas.")
            return

        with open(file_path, 'rb') as f:
            # Vérifie que le premier caractère est `[`
            first_char = f.read(1)
            if first_char != b'[':
                print("❌ Le fichier ne commence pas par un '[' (tableau JSON).")
                return

            # Vérifie que le dernier caractère significatif est `]`
            f.seek(-1, os.SEEK_END)
            while True:
                last_char = f.read(1)
                if last_char in b'\n\r \t':
                    f.seek(-2, os.SEEK_CUR)
                else:
                    break
            if last_char != b']':
                print("❌ Le fichier ne se termine pas par un ']' (fin de tableau JSON).")
                return

        # Stream parsing du contenu
        count = 0
        with open(file_path, 'rb') as f:
            parser = ijson.items(f, 'item')
            for item in parser:
                if not isinstance(item, dict):
                    print(f"❌ Élément {count} n'est pas un objet JSON valide.")
                    return
                count += 1

        print(f"✅ Fichier JSON valide. {count} objets lus avec succès.")

    except Exception as e:
        print(f"❌ Erreur pendant la lecture ou le parsing : {e}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        default_path = os.path.join(
            os.path.dirname(__file__),
            '../data/stoptimes.json'
        )
        print(f"ℹ️ Aucun chemin fourni, utilisation par défaut : {default_path}")
        validate_json_array(default_path)
    else:
        validate_json_array(sys.argv[1])