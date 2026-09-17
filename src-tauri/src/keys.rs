//! The Anthropic API key lives in the OS keychain, never in the database.

use keyring::Entry;

const SERVICE: &str = "com.juando.aianalyzer";
const ACCOUNT: &str = "anthropic-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Couldn't open the keychain: {e}"))
}

pub fn read() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Couldn't read the key from the keychain: {e}")),
    }
}

pub fn save(key: &str) -> Result<(), String> {
    entry()?
        .set_password(key.trim())
        .map_err(|e| format!("Couldn't save the key in the keychain: {e}"))
}

pub fn clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Couldn't remove the key from the keychain: {e}")),
    }
}
