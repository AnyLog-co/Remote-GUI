import Dexie from "dexie";
import { applyEncryptionMiddleware, NON_INDEXED_FIELDS } from "dexie-encrypted";

let db = null;

export const Vault = {
	unlock: async (password) => {
		const encoder = new TextEncoder();
		const passwordBuffer = encoder.encode(password);
		const salt = encoder.encode("TEMP_SALT");
		
		const keyMaterial = await window.crypto.subtle.importKey(
			"raw",
			passwordBuffer,
			"PBKDF2",
			false,
			["deriveBits", "deriveKey"],
		);
		
		const derivedKeyBuf = await window.crypto.subtle.deriveBits(
			{
				name: "PBKDF2",
				salt: salt,
				iterations: 1000000,
				hash: "SHA-256",
			},
			keyMaterial,
			256,
		);
		
		const rawKey = new Uint8Array(derivedKeyBuf);
		const instance = new Dexie("plugins/cli/vault");
		
		applyEncryptionMiddleware(instance, rawKey, {
			secrets: NON_INDEXED_FIELDS,
		});
		
		instance.version(1).stores({
			secrets: "++id",
		});
		
		await instance.open();
		db = instance;
		return db;
	},
	
	lock: () => {
		if (db) {
			db.close();
			db = null;
		}
	},
	
	getDb: () => db,
	
	saveSecret: async (content) => {
		if (!db) throw new Error("Vault locked");
		
		// Simply save to Dexie - don't update Zustand state here
		// The state will be updated by loadSecretsFromVault() after this call
		const id = await db.secrets.add({
			content: {
				hostname: content.hostname,
				username: content.username || "root", // Default to root
				type: content.type,
				ref: content.ref || "",
				credential: content.credential,
			},
			date: new Date().toISOString(),
			tags: ["private"],
		});
		
		return id;
	},
	
	reset: async () => {
		if (db) {
			db.close();
			db = null;
		}
		await Dexie.delete("plugins/cli/vault");
		console.log("Vault reset.");
	},
};