export const waitForChildProcessSpawn = (child) => new Promise((resolve, reject) => {
  const onSpawn = () => {
    child.off("error", onError);
    resolve(child);
  };
  const onError = (error) => {
    child.off("spawn", onSpawn);
    reject(error);
  };

  child.once("spawn", onSpawn);
  child.once("error", onError);
});
