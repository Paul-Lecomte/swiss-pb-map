import ijson
import sys
import os

def validate_json_array(file_path):
    try:
        file_path = os.path.abspath(file_path)
        print(f"🔍 Validating file: {file_path}")

        # Check that the file exists
        if not os.path.exists(file_path):
            print("❌ File does not exist.")
            return

        with open(file_path, 'rb') as f:
            # Check that the first character is `[` (JSON array)
            first_char = f.read(1)
            if first_char != b'[':
                print("❌ File does not start with '[' (expected JSON array).")
                return

            # Check that the last significant character is `]`
            f.seek(-1, os.SEEK_END)
            while True:
                last_char = f.read(1)
                if last_char in b'\n\r \t':
                    f.seek(-2, os.SEEK_CUR)
                else:
                    break
            if last_char != b']':
                print("❌ File does not end with ']' (expected end of JSON array).")
                return

        # Stream-parse the content
        count = 0
        with open(file_path, 'rb') as f:
            parser = ijson.items(f, 'item')
            for item in parser:
                if not isinstance(item, dict):
                    print(f"❌ Element {count} is not a valid JSON object.")
                    return
                count += 1

        print(f"✅ Valid JSON file. {count} objects read successfully.")

    except Exception as e:
        print(f"❌ Error while reading or parsing: {e}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        default_path = os.path.join(
            os.path.dirname(__file__),
            '../data/stoptimes.json'
        )
        print(f"ℹ️ No path provided, using default: {default_path}")
        validate_json_array(default_path)
    else:
        validate_json_array(sys.argv[1])