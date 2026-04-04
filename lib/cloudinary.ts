// lib/cloudinary.ts

/** Upload a base64 image string to Cloudinary. Returns the secure URL. */
export async function uploadToCloudinary(base64: string): Promise<string> {
  const imgData = new FormData();
  imgData.append("file", base64);
  imgData.append("upload_preset", "biolog");
  
  const res = await fetch("https://api.cloudinary.com/v1_1/dvevhirpn/image/upload", { 
    method: "POST", 
    body: imgData 
  });
  
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.message || "Failed to upload image to Cloudinary");
  }
  
  const data = await res.json();
  return data.secure_url;
}
