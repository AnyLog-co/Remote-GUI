from typing import List

def _parse(path: str, dest: List[str]) -> None:
    dest.clear()

    # Clear leading symbols
    if len(path) <= 0:
        return
    if path[0] == '.':
        path = path[1:]
    if len(path) <= 0:
        return
    if path[0] == '/' or path[0] == '\\':
        path = path[1:]
    if len(path) <= 0:
        return
    
    if len(path.split('/')) > 1:
        parsed_elements = path.split('/')
    elif len(path.split('\\')) > 1:
        parsed_elements = path.split('\\')
    else:
        return

    # we want this file upload system to upload only through the /app top directory
    if parsed_elements[0] != 'app':
        dest.clear()
        raise ValueError("File path must start with /app/")

    # we want this file upload system to disallow '..' to stay in /app
    if '..' in parsed_elements:
        dest.clear()
        raise ValueError("File path cannot contain '..'")

    found_ext = False
    for element in parsed_elements:
        if found_ext:
            dest.clear()
            raise ValueError("Cannot have file be child of another file")
        if len(element.split('.')) > 2:
            dest.clear()
            raise ValueError("Cannot have two extensions in filename")
        ext_index = element.find('.')
        if ext_index >= 0:
            if ext_index == 0:
                dest.clear()
                raise ValueError("File must have name before extension")
            found_ext = True
        dest.append(element)

class PathAppendException(ValueError):
    pass

class PathParser:
    def __init__(self, path: str) -> None:
        self.elements: List[str] = []
        _parse(path, self.elements)

    def __repr__(self) -> str:
        if len(self.elements) > 0:
            return f"/{'/'.join(self.elements)}"
        return "."

    def stem(self) -> str | None:
        '''
        Returns the full name of the last file or directory in the path if it
        exists. Returns None if it does not exist.
        '''
        if len(self.elements)  > 0:
            return self.elements[-1]
        return None

    def append(self, new_element: str) -> None:
        '''
        Adds a new element at the end of the path. If the path ends in a file,
        raises a PathAppendException.
        '''
        if self.hasExt():
            raise PathAppendException("Cannot append element to path with an extension.")
        self.elements.append(new_element)

    def parent(self) -> "PathParser":
        '''
        Returns the path of the path's parent element.
        '''
        res = PathParser("")
        if (len(self.elements) > 1):
            res.elements = self.elements[:-1]
        else:
            res.elements = []
        return res
    
    def hasExt(self) -> bool:
        '''
        Returns True if the path ends with a file extension. Returns False
        otherwise.
        '''
        if len(self.elements) > 0:
            return '.' in self.elements[-1]
        return False
    
    def getExt(self) -> str | None:
        '''
        Returns the file extension of the path if it exists. Returns None if it
        does not exist.
        '''
        if self.hasExt():
            return 