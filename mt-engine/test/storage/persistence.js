export async function loadDemoProject() {

  const response = await fetch("./data/demoProject.json");

  if (!response.ok) {
    throw new Error("Failed to load demoProject.json");
  }

  return await response.json();
}

export function saveProjectToFile(projectJson) {

  const blob = new Blob(
    [JSON.stringify(projectJson, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "project.json";
  a.click();

  URL.revokeObjectURL(url);
}